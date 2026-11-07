import { generateText } from "ai";
import type { DataSourceConfig } from "../../../datasource.config";
import { McpError } from "../../../mcp/mcp.errors";
import type { ToolExecutor } from "../../../mcp/mcp.interface";
import { getModel } from "../../../model.registry";
import {
  formatIdentifiersForPrompt,
  NOISY_IDENTIFIER_RULE,
  UNTRUSTED_DATA_RULE,
} from "../../../prompt-guidelines";
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
  params: Readonly<Record<string, unknown>>,
  issueDescription?: string
): string {
  const incidentContext = issueDescription
    ? `\nIncident description (untrusted):\n"""\n${issueDescription}\n"""\n`
    : "";

  return `You are a ${dialect.label} SQL expert investigating a production incident.
Datasource: ${source.name} (${source.id})
${incidentContext}
Tables and their exact column names:
${formatSchemaForPrompt(schema)}

${formatIdentifiersForPrompt(params)}

Write one read-only SQL query that returns the most diagnostic evidence.
Rules:
- Use only SELECT or WITH. Never use INSERT, UPDATE, DELETE, MERGE, DDL, transaction control, or multiple statements.
- Use only the tables and exact column names shown above. Never invent table or column names.
- Map messy identifiers and incident symptom clues to likely columns by name and meaning. For example: customerId -> customer_id; errorCode -> error_code, code, or status; service -> service, component, or app.
- For exact IDs, start with equality. When case or formatting may differ, use LOWER(column) = LOWER('value') or a LIKE '%value%' match.
- Combine alternate columns for the same identifier with OR. Combine different concepts with AND only when the columns support it.
- If the mapping is uncertain, search across plausible text columns instead of guessing one.
- Prefer a time-bounded query using timestamp, created_at, or updated_at columns when available.
- Select relevant columns rather than SELECT * when practical, and add LIMIT 100 unless the query aggregates.
- If no usable identifier exists, query recent evidence and aggregate counts by likely status, error, or service columns.
- Quote literals safely and escape single quotes.
- ${NOISY_IDENTIFIER_RULE}
- ${UNTRUSTED_DATA_RULE}

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
    const { source, params, issueDescription, model } = input;
    const schema = await this.discover(source, executeTool);
    const { text } = await generateText({
      model: getModel(model),
      prompt: buildQueryPrompt(source, this.dialect, schema, params, issueDescription),
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
