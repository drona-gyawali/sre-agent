import { generateText } from "ai";
import type { DataSourceConfig } from "../../../datasource.config";
import { McpError } from "../../../mcp/mcp.errors";
import type { ToolExecutor } from "../../../mcp/mcp.interface";
import { getModel } from "../../../model.registry";
import type { DataSourceAdapter, QueryInput } from "../../datasource.interface";
import type {
  AdapterQueryResult,
  DiscoveryResult,
  IntegrationType,
} from "../../datasource.types";
import {
  cleanGeneratedQuery,
  normalizeSourceData,
} from "../query-result";
import type { SqlDialect } from "./sql.dialect";
import {
  discoverSqlSchema,
  formatSchemaForPrompt,
  type SqlSchema,
} from "./sql.schema";

export {
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  type SqlDialect,
} from "./sql.dialect";

export const cleanGeneratedSql = cleanGeneratedQuery;
export const normalizeSqlData = normalizeSourceData;

function buildQueryPrompt(
  source: DataSourceConfig,
  dialect: SqlDialect,
  schema: SqlSchema,
  params: Readonly<Record<string, unknown>>
): string {
  return `You are a ${dialect.label} SQL expert.
Tables and their exact column names:
${formatSchemaForPrompt(schema)}

Identifiers to search for: ${JSON.stringify(params)}
Write a single read-only SQL query using only the exact column names shown above.
Return the raw query only, no markdown, no backticks, no explanation.`;
}

export class SqlAdapter implements DataSourceAdapter {
  readonly type: IntegrationType;

  constructor(private readonly dialect: SqlDialect) {
    this.type = dialect.type;
  }

  async discover(
    source: DataSourceConfig,
    executeTool: ToolExecutor
  ): Promise<DiscoveryResult> {
    return discoverSqlSchema(source, executeTool, this.dialect);
  }

  async query(
    input: QueryInput,
    executeTool: ToolExecutor
  ): Promise<AdapterQueryResult> {
    const { source, params, model } = input;
    const schema = await this.discover(source, executeTool);
    const { text } = await generateText({
      model: getModel(model),
      prompt: buildQueryPrompt(source, this.dialect, schema, params),
    });
    const sql = cleanGeneratedQuery(text);

    if (!sql) {
      throw new McpError(
        "The model returned an empty SQL query",
        "INVALID_RESPONSE",
        { toolName: source.tools.query }
      );
    }

    const result = await executeTool(source.tools.query, { sql });

    return {
      data: normalizeSourceData(result.text),
      query: sql,
    };
  }
}
