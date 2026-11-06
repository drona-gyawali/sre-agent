import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import {
  parseMetricNames,
  PrometheusAdapter,
} from "@/app/lib/datasource/adapters/prometheus/prometheus.adapter";
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
  id: "metrics",
  name: "prometheus",
  type: "prometheus",
  category: "metrics",
  package: "prometheus-mcp-server",
  tools: {
    query: "prom_query",
    rangeQuery: "prom_range",
    discover: "prom_discover",
  },
  env: { PROMETHEUS_URL: "http://prometheus:9090" },
  settings: { timeRangeMinutes: 15, stepSeconds: 30 },
  enabled: true,
};

const model = "google:gemini-2.5-flash" as RegistryModelId;
const adapter = new PrometheusAdapter();

function toolResult(toolName: string, value: unknown): McpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { toolName, text, content: [{ type: "text", text }] };
}

beforeEach(() => {
  generateText.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseMetricNames", () => {
  it("extracts unique metric names from discovery responses", () => {
    expect(
      parseMetricNames(
        toolResult("prom_discover", {
          metrics: [
            { name: "http_requests_total" },
            { name: "http_requests_total" },
            { name: "process_cpu_seconds_total" },
          ],
        })
      )
    ).toEqual(["http_requests_total", "process_cpu_seconds_total"]);

    expect(
      parseMetricNames(
        toolResult("prom_discover", {
          data: [
            { metric: { __name__: "up" } },
            { metric: { __name__: "node_load1" } },
          ],
        })
      )
    ).toEqual(["up", "node_load1"]);
  });

  it("returns no metrics for an empty discovery response", () => {
    expect(parseMetricNames(toolResult("prom_discover", ""))).toEqual([]);
  });
});

describe("PrometheusAdapter.discover", () => {
  it("returns source metadata and discovered metrics", async () => {
    const executeTool = vi.fn<ToolExecutor>(async (toolName) => {
      expect(toolName).toBe("prom_discover");
      return toolResult(toolName, [{ name: "http_requests_total" }]);
    });

    const result = await adapter.discover(source, executeTool);

    expect(result).toEqual({
      sourceId: "metrics",
      sourceName: "prometheus",
      integrationType: "prometheus",
      category: "metrics",
      tables: [],
      metrics: ["http_requests_total"],
    });
  });

  it("skips discovery when no discovery tool is configured", async () => {
    const executeTool = vi.fn<ToolExecutor>();

    const result = await adapter.discover(
      { ...source, tools: { query: "prom_query" } },
      executeTool
    );

    expect(result.metrics).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("returns no metrics when the discovery tool is unavailable", async () => {
    const executeTool = vi.fn<ToolExecutor>(async (toolName) => {
      throw new Error(`Unknown MCP tool "${toolName}"`);
    });

    const result = await adapter.discover(source, executeTool);

    expect(result.metrics).toEqual([]);
  });
});

describe("PrometheusAdapter.query", () => {
  it("generates PromQL and executes a bounded range query", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:15:00.000Z"));
    generateText.mockResolvedValue({
      text: "```promql\nrate(http_requests_total{job=\"api\"}[5m])\n```",
    });

    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      if (toolName === "prom_discover") {
        return toolResult(toolName, [{ name: "http_requests_total" }]);
      }

      expect(toolName).toBe("prom_range");
      expect(args).toEqual({
        query: 'rate(http_requests_total{job="api"}[5m])',
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-01T00:15:00.000Z",
        step: "30s",
      });
      return toolResult(toolName, {
        resultType: "matrix",
        result: [{ metric: { __name__: "http_requests_total" } }],
      });
    });

    const result = await adapter.query(
      { source, params: { service: "api" }, model },
      executeTool
    );

    expect(result).toEqual({
      data: {
        resultType: "matrix",
        result: [{ metric: { __name__: "http_requests_total" } }],
      },
      query: 'rate(http_requests_total{job="api"}[5m])',
    });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("http_requests_total"),
      })
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"service":"api"'),
      })
    );
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("uses the instant query tool when no range tool is configured", async () => {
    generateText.mockResolvedValue({ text: "up" });

    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      expect(toolName).toBe("prom_query");
      expect(args).toEqual({ query: "up" });
      return toolResult(toolName, [{ metric: { __name__: "up" }, value: [1, "1"] }]);
    });

    const result = await adapter.query(
      {
        source: { ...source, tools: { query: "prom_query" } },
        params: {},
        model,
      },
      executeTool
    );

    expect(result.query).toBe("up");
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty generated query", async () => {
    generateText.mockResolvedValue({ text: "   " });
    const executeTool = vi.fn<ToolExecutor>();

    await expect(
      adapter.query(
        { source: { ...source, tools: { query: "prom_query" } }, params: {}, model },
        executeTool
      )
    ).rejects.toMatchObject({
      name: "McpError",
      code: "INVALID_RESPONSE",
    });
    expect(executeTool).not.toHaveBeenCalled();
  });
});
