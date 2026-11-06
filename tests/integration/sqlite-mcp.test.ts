import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import {
  SqlAdapter,
  SQLITE_DIALECT,
} from "@/app/lib/datasource/adapters/sql/sql.adapter";
import { createDefaultDataSourceRegistry } from "@/app/lib/datasource/datasource.registry";
import { DataSourceService } from "@/app/lib/datasource/datasource.service";
import { McpSession } from "@/app/lib/mcp/mcp-manager";
import type { McpServerConfig } from "@/app/lib/mcp/mcp.interface";
import type { RegistryModelId } from "@/app/lib/model.registry";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({ generateText }));
vi.mock("@/app/lib/model.registry", () => ({
  getModel: vi.fn(() => "test-model"),
}));

const model = "google:gemini-2.5-flash" as RegistryModelId;
const adapter = new SqlAdapter(SQLITE_DIALECT);

const require = createRequire(import.meta.url);
const sqliteServerEntry = require.resolve("mcp-sqlite");

const workspace = mkdtempSync(join(tmpdir(), "sre-agent-sqlite-"));
const databasePath = join(workspace, "database.db");
let session: McpSession | undefined;

const serverConfig: McpServerConfig = {
  name: "sqlite-test-client",
  prefix: "test",
  command: process.execPath,
  args: [sqliteServerEntry, databasePath],
  env: {},
};

const source: DataSourceConfig = {
  id: "database",
  name: "test",
  type: "sqlite",
  category: "database",
  package: "mcp-sqlite",
  tools: {
    query: "test_query",
    listTables: "test_list_tables",
    describeTable: "test_get_table_schema",
  },
  env: {},
  connection: databasePath,
  settings: { timeRangeMinutes: 60, stepSeconds: 60 },
  enabled: true,
};

beforeAll(async () => {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      customer_id TEXT NOT NULL,
      email TEXT
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id TEXT NOT NULL,
      status TEXT,
      amount REAL,
      created_at TEXT
    );
  `);
  database
    .prepare("INSERT INTO customers VALUES (?, ?, ?)")
    .run(1, "C-1001", "customer@example.com");
  database
    .prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)")
    .run(1, "C-1001", "failed", 299.99, "2024-11-01 10:23:00");
  database
    .prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)")
    .run(2, "C-1002", "success", 49.5, "2024-11-01 11:00:00");
  database.close();

  session = await McpSession.create([serverConfig]);
}, 30_000);

afterAll(async () => {
  if (session) await session.close();
  rmSync(workspace, { recursive: true, force: true });
}, 30_000);

beforeEach(() => {
  generateText.mockReset();
});

function activeSession(): McpSession {
  if (!session) throw new Error("MCP session was not initialized");
  return session;
}

describe("SQLite MCP integration", () => {
  it("discovers the real server tools with datasource prefixes", () => {
    const toolNames = activeSession().tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "test_query",
        "test_list_tables",
        "test_get_table_schema",
      ])
    );
  });

  it("discovers tables and columns through mcp-sqlite", async () => {
    const schema = await adapter.discover(source, activeSession().executeTool);

    expect(schema).toMatchObject({
      sourceId: "database",
      sourceName: "test",
      integrationType: "sqlite",
      category: "database",
    });
    expect(schema.tables.map((table) => table.name).sort()).toEqual([
      "customers",
      "orders",
    ]);

    const customers = schema.tables.find(
      (table) => table.name === "customers"
    );

    expect(customers?.columns.map((column) => column.name)).toEqual([
      "id",
      "customer_id",
      "email",
    ]);
    expect(customers?.columns[0]).toMatchObject({
      name: "id",
      type: "INTEGER",
      primaryKey: true,
    });
  });

  it("executes queries through the centralized session", async () => {
    const result = await activeSession().executeTool("test_query", {
      sql: "SELECT customer_id, status FROM orders WHERE customer_id = 'C-1001'",
    });

    expect(result.text).toContain("C-1001");
    expect(result.text).toContain("failed");
  });

  it("supports concurrent tool calls", async () => {
    const [tables, orders] = await Promise.all([
      activeSession().executeTool("test_list_tables", {}),
      activeSession().executeTool("test_query", {
        sql: "SELECT COUNT(*) AS count FROM orders",
      }),
    ]);

    expect(tables.text).toContain("customers");
    expect(orders.text).toContain('"count": 2');
  });

  it("turns MCP tool errors into structured errors", async () => {
    await expect(
      activeSession().executeTool("test_query", {
        sql: "SELECT * FROM table_that_does_not_exist",
      })
    ).rejects.toMatchObject({
      name: "McpError",
      code: "TOOL_EXECUTION_FAILED",
      context: {
        serverName: "sqlite-test-client",
        toolName: "test_query",
      },
    });
  });

  it("reports unknown tools without contacting a server", async () => {
    await expect(
      activeSession().executeTool("not_a_real_tool", {})
    ).rejects.toMatchObject({
      name: "McpError",
      code: "TOOL_NOT_FOUND",
    });
  });

  it("closes clients exactly once and rejects later calls", async () => {
    const closeableSession = await McpSession.create([serverConfig]);

    await closeableSession.close();
    await closeableSession.close();

    await expect(
      closeableSession.executeTool("test_list_tables", {})
    ).rejects.toMatchObject({
      name: "McpError",
      code: "SESSION_CLOSED",
    });
  });

  it("rejects duplicate resolved tool names across servers", async () => {
    await expect(
      McpSession.create([serverConfig, { ...serverConfig, name: "other" }])
    ).rejects.toMatchObject({
      name: "McpError",
      code: "DUPLICATE_TOOL",
    });
  });

  it("wraps connection failures in a structured error", async () => {
    await expect(
      McpSession.create([
        {
          name: "missing-server",
          command: "/definitely/not/a/real/command",
          args: [],
        },
      ])
    ).rejects.toMatchObject({
      name: "McpError",
      code: "CONNECTION_FAILED",
      context: { serverName: "missing-server" },
    });
  });
});

describe("SQLite adapter and service integration", () => {
  function createService(): DataSourceService {
    return new DataSourceService({
      registry: createDefaultDataSourceRegistry(),
      executeTool: activeSession().executeTool,
      model,
    });
  }

  it("executes a generated query through the registry, adapter, and session", async () => {
    generateText.mockResolvedValue({
      text: "SELECT customer_id, status FROM orders WHERE customer_id = 'C-1001'",
    });

    const result = await createService().query(source, {
      customerId: "C-1001",
    });

    expect(result).toMatchObject({
      sourceId: "database",
      sourceName: "test",
      integrationType: "sqlite",
      category: "database",
      status: "success",
      query:
        "SELECT customer_id, status FROM orders WHERE customer_id = 'C-1001'",
    });
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customer_id: "C-1001",
          status: "failed",
        }),
      ])
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("normalizes real MCP query failures into a failed SourceResult", async () => {
    generateText.mockResolvedValue({
      text: "SELECT * FROM table_that_does_not_exist",
    });

    const result = await createService().investigateSource(source, {});

    expect(result).toMatchObject({
      sourceId: "database",
      status: "failed",
      data: null,
    });
    expect(result.error).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
