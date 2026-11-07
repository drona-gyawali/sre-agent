import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import {
  cleanGeneratedSql,
  normalizeSqlData,
  POSTGRES_DIALECT,
  SqlAdapter,
  SQLITE_DIALECT,
} from "@/app/lib/datasource/adapters/sql/sql.adapter";
import type { McpToolResult, ToolExecutor } from "@/app/lib/mcp/mcp.interface";
import type { RegistryModelId } from "@/app/lib/model.registry";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({ generateText }));
vi.mock("@/app/lib/model.registry", () => ({
  getModel: vi.fn(() => "test-model"),
}));

const source: DataSourceConfig = {
  id: "database",
  name: "db",
  type: "sqlite",
  category: "database",
  package: "mcp-sqlite",
  tools: {
    query: "db_query",
    listTables: "db_list_tables",
    describeTable: "db_get_table_schema",
  },
  env: {},
  connection: "/tmp/database.db",
  settings: { timeRangeMinutes: 60, stepSeconds: 60 },
  enabled: true,
};

const model = "google:gemini-2.5-flash" as RegistryModelId;
const adapter = new SqlAdapter(SQLITE_DIALECT);

function toolResult(toolName: string, value: unknown): McpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { toolName, text, content: [{ type: "text", text }] };
}

function schemaExecutor(queryResult: McpToolResult): ToolExecutor {
  return vi.fn(async (toolName, args) => {
    if (toolName === "db_list_tables") {
      return toolResult(toolName, [{ name: "records" }]);
    }

    if (toolName === "db_get_table_schema") {
      expect(args).toEqual({ tableName: "records" });
      return toolResult(toolName, [
        { name: "customer_id", type: "TEXT", notnull: 0, pk: 0 },
      ]);
    }

    return queryResult;
  });
}

beforeEach(() => {
  generateText.mockReset();
});

describe("SqlAdapter.query", () => {
  it("discovers schema, cleans generated SQL, and returns normalized data", async () => {
    generateText.mockResolvedValue({
      text: "```sql\nSELECT * FROM records WHERE customer_id = 'C-1001'\n```",
    });

    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      if (toolName === "db_list_tables") {
        return toolResult(toolName, [{ name: "records" }]);
      }

      if (toolName === "db_get_table_schema") {
        expect(args).toEqual({ tableName: "records" });
        return toolResult(toolName, [
          { name: "customer_id", type: "TEXT", notnull: 0, pk: 0 },
        ]);
      }

      if (toolName === "db_query") {
        expect(args).toEqual({
          sql: "SELECT * FROM records WHERE customer_id = 'C-1001'",
        });
        return toolResult(toolName, [{ customer_id: "C-1001" }]);
      }

      throw new Error(`Unexpected tool: ${toolName}`);
    });

    const result = await adapter.query(
      {
        source,
        params: { customerId: "C-1001" },
        model,
      },
      executeTool
    );

    expect(result).toEqual({
      data: [{ customer_id: "C-1001" }],
      query: "SELECT * FROM records WHERE customer_id = 'C-1001'",
    });
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        prompt: expect.stringContaining("SQLite SQL expert"),
      })
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("customer_id TEXT"),
      })
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"customerId":"C-1001"'),
      })
    );

    const prompt = generateText.mock.calls[0]?.[0]?.prompt as string;

    expect(prompt).toContain("Never use INSERT");
    expect(prompt).toContain("LOWER(column)");
    expect(prompt).toContain("LIMIT 100");
    expect(prompt).toContain("untrusted evidence");
  });

  it("rejects an empty generated query before calling the query tool", async () => {
    generateText.mockResolvedValue({ text: "   " });
    const executeTool = schemaExecutor(
      toolResult("db_query", [{ unexpected: true }])
    );

    await expect(
      adapter.query(
        { source, params: { customerId: "C-1001" }, model },
        executeTool
      )
    ).rejects.toMatchObject({
      name: "McpError",
      code: "INVALID_RESPONSE",
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("normalizes an empty query response to a successful empty result", async () => {
    generateText.mockResolvedValue({ text: "SELECT * FROM records" });

    const result = await adapter.query(
      { source, params: {}, model },
      schemaExecutor(toolResult("db_query", ""))
    );

    expect(result).toEqual({
      data: "No results",
      query: "SELECT * FROM records",
    });
  });

  it("keeps non-JSON query responses as text", async () => {
    generateText.mockResolvedValue({ text: "SELECT * FROM records" });

    const result = await adapter.query(
      { source, params: {}, model },
      schemaExecutor(toolResult("db_query", "Query returned 0 rows"))
    );

    expect(result.data).toBe("Query returned 0 rows");
  });
});

describe("SqlAdapter with PostgreSQL", () => {
  const postgresSource: DataSourceConfig = {
    ...source,
    type: "postgres",
    package: "@modelcontextprotocol/server-postgres",
    connection: "postgresql://user:secret@db:5432/app",
    tools: { query: "query" },
  };

  it("discovers schema and queries through a PostgreSQL MCP server", async () => {
    generateText.mockResolvedValue({
      text: "```sql\nSELECT * FROM orders WHERE customer_id = 'C-1001'\n```",
    });

    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      expect(toolName).toBe("query");

      if (args?.sql === POSTGRES_DIALECT.discovery?.tables) {
        return toolResult(toolName, [{ name: "orders" }]);
      }

      if (args?.sql === POSTGRES_DIALECT.discovery?.columns) {
        return toolResult(toolName, {
          rows: [
            {
              table_name: "orders",
              name: "customer_id",
              type: "text",
              not_null: true,
              pk: false,
              default_value: null,
            },
          ],
        });
      }

      expect(args).toEqual({
        sql: "SELECT * FROM orders WHERE customer_id = 'C-1001'",
      });
      return toolResult(toolName, [{ customer_id: "C-1001" }]);
    });

    const result = await new SqlAdapter(POSTGRES_DIALECT).query(
      {
        source: postgresSource,
        params: { customerId: "C-1001" },
        model,
      },
      executeTool
    );

    expect(result).toEqual({
      data: [{ customer_id: "C-1001" }],
      query: "SELECT * FROM orders WHERE customer_id = 'C-1001'",
    });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("PostgreSQL SQL expert"),
      })
    );
    expect(executeTool).toHaveBeenCalledTimes(3);
  });
});

describe("SqlAdapter.discover", () => {
  it("returns a discovery result with source metadata", async () => {
    const executeTool: ToolExecutor = async (toolName) => {
      if (toolName === "db_list_tables") {
        return toolResult(toolName, ["records"]);
      }

      return toolResult(toolName, [
        { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
      ]);
    };

    const result = await adapter.discover(source, executeTool);

    expect(result).toMatchObject({
      sourceId: "database",
      sourceName: "db",
      integrationType: "sqlite",
      category: "database",
    });
    expect(result.tables).toEqual([
      {
        name: "records",
        columns: [
          {
            name: "id",
            type: "INTEGER",
            notNull: false,
            primaryKey: true,
            defaultValue: null,
          },
        ],
      },
    ]);
  });
});

describe("SQL helpers", () => {
  it("removes markdown fences and preserves raw SQL", () => {
    expect(
      cleanGeneratedSql(
        "```sql\nSELECT * FROM records WHERE customer_id = 'C-1001'\n```"
      )
    ).toBe("SELECT * FROM records WHERE customer_id = 'C-1001'");
    expect(cleanGeneratedSql("  SELECT 1  ")).toBe("SELECT 1");
  });

  it("parses JSON data and falls back to text", () => {
    expect(normalizeSqlData('[{"id":1}]')).toEqual([{ id: 1 }]);
    expect(normalizeSqlData("plain text")).toBe("plain text");
    expect(normalizeSqlData("  ")).toBe("No results");
  });
});
