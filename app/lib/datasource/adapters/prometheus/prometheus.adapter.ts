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
  params: Readonly<Record<string, unknown>>
): string {
  const metricHint =
    metrics.length > 0
      ? `\nKnown metric names:\n${metrics.join("\n")}`
      : "";

  return `You are a Prometheus PromQL expert.
Datasource: ${source.name}${metricHint}

Identifiers to search for: ${JSON.stringify(params)}
Write a single read-only PromQL query.
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

  async discover(
    source: DataSourceConfig,
    executeTool: ToolExecutor
  ): Promise<DiscoveryResult> {
    const metrics = source.tools.discover
      ? parseMetricNames(await executeTool(source.tools.discover, {}))
      : [];

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
    const { source, params, model } = input;
    const discovery = await this.discover(source, executeTool);
    const { text } = await generateText({
      model: getModel(model),
      prompt: buildQueryPrompt(source, discovery.metrics ?? [], params),
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
