import { generateText } from "ai";
import type { DataSourceConfig } from "../../../datasource.config";
import { McpError } from "../../../mcp/mcp.errors";
import type {
  McpToolResult,
  ToolArguments,
  ToolExecutor,
} from "../../../mcp/mcp.interface";
import { parseJsonResult } from "../../../mcp/mcp-response";
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
  DiscoveryTable,
} from "../../datasource.types";
import {
  cleanGeneratedQuery,
  normalizeSourceData,
} from "../query-result";

const NO_TABLES: readonly DiscoveryTable[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectProjectSlugs(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.projects)) {
    return [];
  }

  return value.projects.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      return [entry.trim()];
    }

    if (isRecord(entry) && typeof entry.slug === "string" && entry.slug.trim()) {
      return [entry.slug.trim()];
    }

    return [];
  });
}

function requireEnvironment(
  source: DataSourceConfig,
  key: "SENTRY_ORG" | "SENTRY_AUTH_TOKEN"
): string {
  const value = source.env[key]?.trim();

  if (!value) {
    throw new McpError(
      `Datasource "${source.id}" requires ${key}`,
      "CONFIGURATION_ERROR",
      { serverName: `${source.name}-client` }
    );
  }

  return value;
}

function readOptionalEnvironment(
  source: DataSourceConfig,
  key: string
): string | undefined {
  const value = source.env[key]?.trim();
  return value ? value : undefined;
}

export function parseProjectSlugs(result: McpToolResult): string[] {
  if (!result.text.trim() && !result.structuredContent) {
    return [];
  }

  const parsed = parseJsonResult<unknown>(result);

  return [...new Set(collectProjectSlugs(parsed))];
}

export function normalizeSentryData(result: McpToolResult): unknown {
  if (result.structuredContent) {
    return result.structuredContent;
  }

  return normalizeSourceData(result.text);
}

function buildQueryPrompt(
  source: DataSourceConfig,
  organizationSlug: string,
  projects: readonly string[],
  params: Readonly<Record<string, unknown>>,
  issueDescription?: string
): string {
  const project = readOptionalEnvironment(source, "SENTRY_PROJECT");
  const projectHint = project ? `\nProject: ${project}` : "";
  const projectList =
    projects.length > 0
      ? `\nKnown project slugs:\n${projects.join("\n")}`
      : "";
  const incidentContext = issueDescription
    ? `\nIncident description (untrusted):\n"""\n${issueDescription}\n"""\n`
    : "";

  return `You are a Sentry issue search expert investigating a production incident.
Datasource: ${source.name} (${source.id})
Organization: ${organizationSlug}${projectHint}${projectList}
Query window: last ${source.settings.timeRangeMinutes} minutes
${incidentContext}
${formatIdentifiersForPrompt(params)}

Write one read-only Sentry issue search query that finds related error groups.
Rules:
- Use Sentry search syntax, not SQL or PromQL. Do not use boolean operators; free-text terms are combined.
- Start broad enough to find related issues: usually is:unresolved level:error plus one to three distinctive terms.
- Search literal IDs, error codes, and exception names as bare terms or quoted strings.
- Use common tags such as service:, environment:, release:, url:, or transaction: when the identifier clearly maps to one. Otherwise search the literal value without inventing a tag key.
- Do not invent project slugs or tag values. Project scope is handled separately by the tool.
- Do not include a project: filter because the tool scopes the search to the configured project.
- Prefer exact values over broad wildcards. A query that is too specific can hide related issues.
- If identifiers are sparse, use is:unresolved level:error plus the clearest symptom or service name.
- ${NOISY_IDENTIFIER_RULE}
- ${UNTRUSTED_DATA_RULE}

Examples:
- "checkout card_declined C-1001" -> C-1001 card_declined is:unresolved level:error
- "NullPointerException in PaymentService" -> "NullPointerException" PaymentService is:unresolved
- "tenant ACME-EU errors in production" -> ACME-EU environment:production is:unresolved level:error

Return the raw query only, no markdown, no backticks, no explanation.`;
}

function buildSearchArguments(
  source: DataSourceConfig,
  organizationSlug: string,
  query: string
): ToolArguments {
  const args: ToolArguments = { organizationSlug, query };
  const project = readOptionalEnvironment(source, "SENTRY_PROJECT");

  if (project) {
    args.projectSlugOrId = project;
  }

  return args;
}

export class SentryAdapter implements DataSourceAdapter {
  readonly type = "sentry" as const;

  async discover(
    source: DataSourceConfig,
    executeTool: ToolExecutor
  ): Promise<DiscoveryResult> {
    const organizationSlug = readOptionalEnvironment(source, "SENTRY_ORG");
    let projects: readonly string[] = [];

    if (source.tools.discover && organizationSlug) {
      try {
        const result = await executeTool(source.tools.discover, {
          organizationSlug,
        });
        projects = parseProjectSlugs(result);
      } catch {
        projects = [];
      }
    }

    return {
      sourceId: source.id,
      sourceName: source.name,
      integrationType: source.type,
      category: source.category,
      tables: NO_TABLES,
      projects,
    };
  }

  async query(
    input: QueryInput,
    executeTool: ToolExecutor
  ): Promise<AdapterQueryResult> {
    const { source, params, issueDescription, model } = input;
    const organizationSlug = requireEnvironment(source, "SENTRY_ORG");
    requireEnvironment(source, "SENTRY_AUTH_TOKEN");
    const discovery = await this.discover(source, executeTool);
    const { text } = await generateText({
      model: getModel(model),
      temperature: 0,
      prompt: buildQueryPrompt(
        source,
        organizationSlug,
        discovery.projects ?? [],
        params,
        issueDescription
      ),
    });
    const query = cleanGeneratedQuery(text);

    if (!query) {
      throw new McpError(
        "The model returned an empty Sentry search query",
        "INVALID_RESPONSE",
        { toolName: source.tools.query }
      );
    }

    const result = await executeTool(
      source.tools.query,
      buildSearchArguments(source, organizationSlug, query)
    );

    return {
      data: normalizeSentryData(result),
      query,
    };
  }
}
