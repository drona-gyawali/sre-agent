import type { DataSourceConfig } from "../../../datasource.config";
import { McpError } from "../../../mcp/mcp.errors";
import type { McpToolResult, ToolExecutor } from "../../../mcp/mcp.interface";
import { parseJsonResult } from "../../../mcp/mcp-response";
import type {
  DiscoveryColumn,
  DiscoveryResult,
  DiscoveryTable,
} from "../../datasource.types";
import { SQLITE_DIALECT, type SqlDialect } from "./sql.dialect";

export interface SqlSchema {
  readonly tables: readonly DiscoveryTable[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(result: McpToolResult, detail: string): McpError {
  return new McpError(
    `MCP tool "${result.toolName}" returned an invalid response: ${detail}`,
    "INVALID_RESPONSE",
    { toolName: result.toolName }
  );
}

function readTableNames(
  result: McpToolResult,
  parsed: unknown
): readonly string[] {
  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => {
      if (typeof item === "string" && item.trim()) {
        return item;
      }

      if (isRecord(item) && typeof item.name === "string" && item.name.trim()) {
        return item.name;
      }

      throw invalidResponse(result, `table entry ${index} has no valid name`);
    });
  }

  if (isRecord(parsed) && Array.isArray(parsed.tables)) {
    return readTableNames(result, parsed.tables);
  }

  if (isRecord(parsed) && Array.isArray(parsed.rows)) {
    return readTableNames(result, parsed.rows);
  }

  throw invalidResponse(result, "expected an array of tables");
}

export function parseTableNames(result: McpToolResult): string[] {
  if (!result.text.trim() && !result.structuredContent) {
    return [];
  }

  const parsed = parseJsonResult<unknown>(result);

  if (isRecord(parsed) && Object.keys(parsed).length === 0) {
    return [];
  }

  if (
    isRecord(parsed) &&
    typeof parsed.message === "string" &&
    /no tables/i.test(parsed.message)
  ) {
    return [];
  }

  return [...new Set(readTableNames(result, parsed))];
}

function readColumnRows(result: McpToolResult): readonly unknown[] {
  if (!result.text.trim() && !result.structuredContent) {
    return [];
  }

  const parsed = parseJsonResult<unknown>(result);
  const rows =
    isRecord(parsed) && Array.isArray(parsed.rows)
      ? parsed.rows
      : isRecord(parsed) && Array.isArray(parsed.columns)
        ? parsed.columns
        : parsed;

  if (!Array.isArray(rows)) {
    throw invalidResponse(result, "expected an array of columns");
  }

  return rows;
}

function normalizeColumn(
  result: McpToolResult,
  column: unknown,
  index: number
): DiscoveryColumn {
  if (!isRecord(column)) {
    throw invalidResponse(result, `column ${index} is not an object`);
  }

  if (typeof column.name !== "string" || !column.name.trim()) {
    throw invalidResponse(result, `column ${index} is missing a valid name`);
  }

  return {
    name: column.name,
    type: typeof column.type === "string" ? column.type : "",
    notNull:
      column.notnull === 1 ||
      column.notnull === true ||
      column.not_null === 1 ||
      column.not_null === true ||
      column.notNull === true,
    primaryKey:
      column.pk === 1 ||
      column.pk === true ||
      column.primary_key === 1 ||
      column.primary_key === true ||
      column.primaryKey === true,
    defaultValue:
      column.dflt_value ?? column.defaultValue ?? column.default_value ?? null,
  };
}

export function parseTableColumns(
  result: McpToolResult
): DiscoveryColumn[] {
  return readColumnRows(result).map((column, index) =>
    normalizeColumn(result, column, index)
  );
}

export function parseTableColumnsByTable(
  result: McpToolResult
): Map<string, DiscoveryColumn[]> {
  const grouped = new Map<string, DiscoveryColumn[]>();

  readColumnRows(result).forEach((column, index) => {
    if (!isRecord(column)) {
      throw invalidResponse(result, `column ${index} is not an object`);
    }

    const tableName =
      typeof column.table_name === "string"
        ? column.table_name
        : typeof column.tableName === "string"
          ? column.tableName
          : undefined;

    if (!tableName?.trim()) {
      throw invalidResponse(result, `column ${index} is missing table_name`);
    }

    const normalized = normalizeColumn(result, column, index);
    const columns = grouped.get(tableName) ?? [];
    columns.push(normalized);
    grouped.set(tableName, columns);
  });

  return grouped;
}

async function discoverWithTools(
  source: DataSourceConfig,
  executeTool: ToolExecutor,
  dialect: SqlDialect
): Promise<DiscoveryResult | undefined> {
  const { listTables, describeTable } = source.tools;

  if (!listTables || !describeTable) {
    return undefined;
  }

  const tableNames = parseTableNames(await executeTool(listTables, {}));

  const tables = await Promise.all(
    tableNames.map(async (tableName) => ({
      name: tableName,
      columns: parseTableColumns(
        await executeTool(
          describeTable,
          dialect.describeTableArguments(tableName)
        )
      ),
    }))
  );

  return {
    sourceId: source.id,
    sourceName: source.name,
    integrationType: source.type,
    category: source.category,
    tables,
  };
}

async function discoverWithSql(
  source: DataSourceConfig,
  executeTool: ToolExecutor,
  dialect: SqlDialect
): Promise<DiscoveryResult | undefined> {
  if (!dialect.discovery) {
    return undefined;
  }

  const tableNames = parseTableNames(
    await executeTool(source.tools.query, { sql: dialect.discovery.tables })
  );

  if (tableNames.length === 0) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      integrationType: source.type,
      category: source.category,
      tables: [],
    };
  }

  const columnsByTable = parseTableColumnsByTable(
    await executeTool(source.tools.query, { sql: dialect.discovery.columns })
  );

  return {
    sourceId: source.id,
    sourceName: source.name,
    integrationType: source.type,
    category: source.category,
    tables: tableNames.map((tableName) => ({
      name: tableName,
      columns: columnsByTable.get(tableName) ?? [],
    })),
  };
}

export async function discoverSqlSchema(
  source: DataSourceConfig,
  executeTool: ToolExecutor,
  dialect: SqlDialect = SQLITE_DIALECT
): Promise<DiscoveryResult> {
  const result =
    (await discoverWithTools(source, executeTool, dialect)) ??
    (await discoverWithSql(source, executeTool, dialect));

  if (!result) {
    throw new McpError(
      `Datasource "${source.id}" has no schema discovery mechanism`,
      "CONFIGURATION_ERROR",
      { toolName: source.tools.query }
    );
  }

  return result;
}

export function formatSchemaForPrompt(schema: SqlSchema): string {
  if (schema.tables.length === 0) {
    return "No tables are available in this datasource.";
  }

  return schema.tables
    .map((table) => {
      const columns = table.columns
        .map((column) => {
          const flags = [
            column.primaryKey ? "PRIMARY KEY" : "",
            column.notNull ? "NOT NULL" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return `  ${column.name} ${column.type}${flags ? ` ${flags}` : ""}`;
        })
        .join(",\n");

      return `${table.name}(\n${columns}\n)`;
    })
    .join("\n\n");
}
