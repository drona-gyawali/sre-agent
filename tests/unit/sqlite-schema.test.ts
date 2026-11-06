import { describe, expect, it, vi } from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import { POSTGRES_DIALECT } from "@/app/lib/datasource/adapters/sql/sql.dialect";
import {
  discoverSqlSchema,
  formatSchemaForPrompt,
  parseTableColumns,
  parseTableColumnsByTable,
  parseTableNames,
} from "@/app/lib/datasource/adapters/sql/sql.schema";
import type { McpToolResult, ToolExecutor } from "@/app/lib/mcp/mcp.interface";

function toolResult(text: string, toolName = "test_tool"): McpToolResult {
  return {
    toolName,
    text,
    content: [{ type: "text", text }],
  };
}

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

describe("parseTableNames", () => {
  it("parses the mcp-sqlite table response", () => {
    expect(
      parseTableNames(
        toolResult(
          JSON.stringify([{ name: "records" }, { name: "customers" }]),
          "db_list_tables"
        )
      )
    ).toEqual(["records", "customers"]);
  });

  it("parses an array of strings and removes duplicates", () => {
    expect(
      parseTableNames(toolResult('["records","records","logs"]'))
    ).toEqual(["records", "logs"]);
  });

  it("treats the empty-database response as no tables", () => {
    expect(
      parseTableNames(
        toolResult(
          JSON.stringify({
            message: "No tables found in database",
            dbPath: "/tmp/database.db",
            exists: true,
            size: 0,
          })
        )
      )
    ).toEqual([]);
  });

  it("rejects malformed table responses", () => {
    expect(() => parseTableNames(toolResult('{"unexpected":true}'))).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" })
    );
  });
});

describe("parseTableColumns", () => {
  it("normalizes PRAGMA table_info rows", () => {
    const columns = parseTableColumns(
      toolResult(
        JSON.stringify([
          {
            cid: 0,
            name: "id",
            type: "INTEGER",
            notnull: 0,
            dflt_value: null,
            pk: 1,
          },
          {
            cid: 1,
            name: "customer_id",
            type: "TEXT",
            notnull: 1,
            dflt_value: null,
            pk: 0,
          },
        ]),
        "db_get_table_schema"
      )
    );

    expect(columns).toEqual([
      {
        name: "id",
        type: "INTEGER",
        notNull: false,
        primaryKey: true,
        defaultValue: null,
      },
      {
        name: "customer_id",
        type: "TEXT",
        notNull: true,
        primaryKey: false,
        defaultValue: null,
      },
    ]);
  });

  it("rejects column entries without a name", () => {
    expect(() =>
      parseTableColumns(toolResult('[{"type":"TEXT"}]'))
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });
});

describe("discoverSqlSchema", () => {
  it("discovers tables and their columns through the executor", async () => {
    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      if (toolName === "db_list_tables") {
        return toolResult(
          JSON.stringify([{ name: "records" }, { name: "logs" }]),
          toolName
        );
      }

      if (toolName === "db_get_table_schema") {
        const tableName = args?.tableName;
        return toolResult(
          JSON.stringify([
            { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
            { name: `${String(tableName)}_value`, type: "TEXT", notnull: 0, pk: 0 },
          ]),
          toolName
        );
      }

      throw new Error(`Unexpected tool: ${toolName}`);
    });

    const schema = await discoverSqlSchema(source, executeTool);

    expect(schema).toMatchObject({
      sourceId: "database",
      sourceName: "db",
      integrationType: "sqlite",
      category: "database",
    });
    expect(schema.tables.map((table) => table.name)).toEqual([
      "records",
      "logs",
    ]);
    expect(schema.tables[0]?.columns).toHaveLength(2);
    expect(executeTool).toHaveBeenCalledWith("db_get_table_schema", {
      tableName: "records",
    });
    expect(executeTool).toHaveBeenCalledWith("db_get_table_schema", {
      tableName: "logs",
    });
  });
});

describe("parseTableColumnsByTable", () => {
  it("groups PostgreSQL column rows by table", () => {
    const columns = parseTableColumnsByTable(
      toolResult(
        JSON.stringify({
          rows: [
            {
              table_name: "orders",
              name: "id",
              type: "integer",
              not_null: true,
              pk: true,
              default_value: null,
            },
            {
              table_name: "orders",
              name: "customer_id",
              type: "text",
              not_null: true,
              pk: false,
              default_value: null,
            },
            {
              table_name: "customers",
              name: "email",
              type: "text",
              not_null: false,
              pk: false,
              default_value: null,
            },
          ],
        }),
        "query"
      )
    );

    expect(columns.get("orders")).toEqual([
      {
        name: "id",
        type: "integer",
        notNull: true,
        primaryKey: true,
        defaultValue: null,
      },
      {
        name: "customer_id",
        type: "text",
        notNull: true,
        primaryKey: false,
        defaultValue: null,
      },
    ]);
    expect(columns.get("customers")?.map((column) => column.name)).toEqual([
      "email",
    ]);
  });

  it("rejects column rows without a table name", () => {
    expect(() =>
      parseTableColumnsByTable(toolResult('[{"name":"id"}]'))
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });
});

describe("formatSchemaForPrompt", () => {
  it("renders exact table and column names with flags", () => {
    const rendered = formatSchemaForPrompt({
      tables: [
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
            {
              name: "customer_id",
              type: "TEXT",
              notNull: true,
              primaryKey: false,
              defaultValue: null,
            },
          ],
        },
      ],
    });

    expect(rendered).toBe(
      "records(\n  id INTEGER PRIMARY KEY,\n  customer_id TEXT NOT NULL\n)"
    );
  });
});

describe("PostgreSQL schema discovery", () => {
  const postgresSource: DataSourceConfig = {
    ...source,
    type: "postgres",
    package: "@modelcontextprotocol/server-postgres",
    connection: "postgresql://user:secret@db:5432/app",
  };

  it("uses PostgreSQL tool argument names when schema tools are configured", async () => {
    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      if (toolName === "list_tables") {
        return toolResult(JSON.stringify([{ name: "orders" }]), toolName);
      }

      expect(toolName).toBe("describe_table");
      expect(args).toEqual({ table_name: "orders" });
      return toolResult(
        JSON.stringify([
          { name: "id", type: "integer", not_null: true, pk: true },
        ]),
        toolName
      );
    });

    const schema = await discoverSqlSchema(
      {
        ...postgresSource,
        tools: {
          query: "query",
          listTables: "list_tables",
          describeTable: "describe_table",
        },
      },
      executeTool,
      POSTGRES_DIALECT
    );

    expect(schema.tables).toEqual([
      {
        name: "orders",
        columns: [
          {
            name: "id",
            type: "integer",
            notNull: true,
            primaryKey: true,
            defaultValue: null,
          },
        ],
      },
    ]);
  });

  it("discovers schema through information_schema when schema tools are absent", async () => {
    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      expect(toolName).toBe("query");
      const sql = String(args?.sql);

      if (sql.includes("information_schema.tables")) {
        return toolResult(
          JSON.stringify([{ name: "orders" }, { name: "customers" }]),
          toolName
        );
      }

      expect(sql).toContain("information_schema.columns");
      return toolResult(
        JSON.stringify({
          rows: [
            {
              table_name: "orders",
              name: "id",
              type: "integer",
              not_null: true,
              pk: true,
              default_value: null,
            },
            {
              table_name: "customers",
              name: "email",
              type: "text",
              not_null: false,
              pk: false,
              default_value: null,
            },
          ],
        }),
        toolName
      );
    });

    const schema = await discoverSqlSchema(
      {
        ...postgresSource,
        tools: { query: "query" },
      },
      executeTool,
      POSTGRES_DIALECT
    );

    expect(schema.tables.map((table) => table.name)).toEqual([
      "orders",
      "customers",
    ]);
    expect(schema.tables[0]?.columns[0]).toMatchObject({
      name: "id",
      notNull: true,
      primaryKey: true,
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when a dialect has no discovery mechanism", async () => {
    await expect(
      discoverSqlSchema(
        {
          ...source,
          tools: { query: "query" },
        },
        vi.fn<ToolExecutor>()
      )
    ).rejects.toMatchObject({
      name: "McpError",
      code: "CONFIGURATION_ERROR",
    });
  });
});
