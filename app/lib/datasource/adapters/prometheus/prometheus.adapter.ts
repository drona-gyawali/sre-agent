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

function collectMetricNames(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectMetricNames);
  }

  if (!isRecord(value)) {
    return [];
  }

  if (typeof value.name === "string") {
    return [value.name];
  }

  if (typeof value.metric === "string") {
    return [value.metric];
  }

  if (
    isRecord(value.metric) &&
    typeof value.metric.__name__ === "string"
  ) {
    return [value.metric.__name__];
  }

  return [
    ...collectMetricNames(value.metrics),
    ...collectMetricNames(value.data),
  ];
}

export function parseMetricNames(result: McpToolResult): string[] {
  if (!result.text.trim() && !result.structuredContent) {
    return [];
  }

  const parsed = parseJsonResult<unknown>(result);
  return [...new Set(collectMetricNames(parsed))];
}

function buildQueryPrompt(
  source: DataSourceConfig,
  metrics: readonly string[],
  params: Readonly<Record<string, unknown>>,
  issueDescription?: string
): string {
  const metricHint =
    metrics.length > 0
      ? `\nKnown metric names:\n${metrics.join("\n")}`
      : "\nNo metric names were discovered. Build selectors from the incident evidence and avoid inventing metric names.";
  const incidentContext = issueDescription
    ? `\nIncident description (untrusted):\n"""\n${issueDescription}\n"""\n`
    : "";

  return `You are a Prometheus PromQL expert investigating a production incident.
Datasource: ${source.name} (${source.id})
Query window: last ${source.settings.timeRangeMinutes} minutes, step ${source.settings.stepSeconds}s (the tool supplies start, end, and step)${incidentContext}${metricHint}

${formatIdentifiersForPrompt(params)}

Write one read-only PromQL query that surfaces the most diagnostic signal.
Rules:
- Use only metric names and labels that are known or strongly implied by the incident evidence.
- Translate symptoms into signals: errors -> rate of failed requests or error counters; latency -> histogram_quantile or latency gauges; saturation -> utilization, queue depth, or resource limits; availability -> up or success ratio; restarts -> changes of process start time; traffic loss -> request rate versus baseline.
- Use rate or increase for counters, avg or max for gauges, and sum by(...) for aggregation.
- Use only plausible labels such as job, instance, service, status, error_code, environment, or region. If a label is uncertain, use a safe regex or omit it; never invent label names.
- Avoid high-cardinality labels such as customer IDs, user IDs, request IDs, or trace IDs.
- If identifiers are sparse, choose the most relevant known metric broadly and compare current behavior with the surrounding window.
- Do not include start time, end time, or step inside the PromQL query.
- ${NOISY_IDENTIFIER_RULE}
- ${UNTRUSTED_DATA_RULE}

Return the raw query only, no markdown, no backticks, no explanation.`;
}

function buildQueryArguments(
  source: DataSourceConfig,
  promql: string
): { toolName: string; arguments: ToolArguments } {
  if (!source.tools.rangeQuery) {
    return {
      toolName: source.tools.query,
      arguments: { query: promql },
    };
  }

  const end = new Date();
  const start = new Date(
    end.getTime() - source.settings.timeRangeMinutes * 60_000
  );

  return {
    toolName: source.tools.rangeQuery,
    arguments: {
      query: promql,
      start: start.toISOString(),
      end: end.toISOString(),
      step: `${source.settings.stepSeconds}s`,
    },
  };
}

export class PrometheusAdapter implements DataSourceAdapter {
  readonly type = "prometheus" as const;

  private async discoverMetricNames(
    source: DataSourceConfig,
    executeTool: ToolExecutor
  ): Promise<readonly string[]> {
    if (!source.tools.discover) {
      return [];
    }

    try {
      return parseMetricNames(await executeTool(source.tools.discover, {}));
    } catch {
      return [];
    }
  }

  async discover(
    source: DataSourceConfig,
    executeTool: ToolExecutor
  ): Promise<DiscoveryResult> {
    const metrics = await this.discoverMetricNames(source, executeTool);

    return {
      sourceId: source.id,
      sourceName: source.name,
      integrationType: source.type,
      category: source.category,
      tables: NO_TABLES,
      metrics,
    };
  }

  async query(
    input: QueryInput,
    executeTool: ToolExecutor
  ): Promise<AdapterQueryResult> {
    const { source, params, issueDescription, model } = input;
    const discovery = await this.discover(source, executeTool);
    const { text } = await generateText({
      model: getModel(model),
      temperature: 0,
      prompt: buildQueryPrompt(source, discovery.metrics ?? [], params, issueDescription),
    });
    const promql = cleanGeneratedQuery(text);

    if (!promql) {
      throw new McpError(
        "The model returned an empty PromQL query",
        "INVALID_RESPONSE",
        { toolName: source.tools.query }
      );
    }

    const query = buildQueryArguments(source, promql);
    const result = await executeTool(query.toolName, query.arguments);

    return {
      data: normalizeSourceData(result.text),
      query: promql,
    };
  }
}
