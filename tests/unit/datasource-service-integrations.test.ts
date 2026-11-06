import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import { createDefaultDataSourceRegistry } from "@/app/lib/datasource/datasource.registry";
import { DataSourceService } from "@/app/lib/datasource/datasource.service";
import { POSTGRES_DIALECT } from "@/app/lib/datasource/adapters/sql/sql.adapter";
import type { McpToolResult, ToolExecutor } from "@/app/lib/mcp/mcp.interface";
import type { RegistryModelId } from "@/app/lib/model.registry";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({ generateText }));
vi.mock("@/app/lib/model.registry", () => ({
  getModel: vi.fn(() => "test-model"),
}));

const model = "google:gemini-2.5-flash" as RegistryModelId;

const postgresSource: DataSourceConfig = {
  id: "postgres",
  name: "orders database",
  type: "postgres",
  category: "database",
  package: "@modelcontextprotocol/server-postgres",
  tools: { query: "query" },
  env: {},
  connection: "postgresql://user:secret@postgres:5432/app",
  settings: { timeRangeMinutes: 60, stepSeconds: 60 },
  enabled: true,
};

const prometheusSource: DataSourceConfig = {
  id: "metrics",
  name: "platform metrics",
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

function toolResult(toolName: string, value: unknown): McpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { toolName, text, content: [{ type: "text", text }] };
}

function sqlResult(toolName: string): McpToolResult {
  return toolResult(toolName, [
    { customer_id: "C-1001", status: "failed", count: 3 },
  ]);
}

function createExecutor(): ToolExecutor {
  return vi.fn(async (toolName, args) => {
    if (toolName === "query") {
      if (args?.sql === POSTGRES_DIALECT.discovery?.tables) {
        return toolResult(toolName, [{ name: "orders" }, { name: "customers" }]);
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
            {
              table_name: "customers",
              name: "id",
              type: "integer",
              not_null: true,
              pk: true,
              default_value: null,
            },
          ],
        });
      }

      return sqlResult(toolName);
    }

    if (toolName === "prom_discover") {
      return toolResult(toolName, [
        { name: "http_requests_total" },
        { name: "http_request_duration_seconds" },
      ]);
    }

    if (toolName === "prom_range") {
      return toolResult(toolName, {
        resultType: "matrix",
        result: [{ metric: { __name__: "http_requests_total" } }],
      });
    }

    throw new Error(`Unexpected tool: ${toolName}`);
  });
}

function createService(executeTool: ToolExecutor): DataSourceService {
  return new DataSourceService({
    registry: createDefaultDataSourceRegistry(),
    executeTool,
    model,
  });
}

beforeEach(() => {
  generateText.mockReset();
});

describe("PostgreSQL and Prometheus integration", () => {
  it("discovers the PostgreSQL schema through the default registry", async () => {
    const service = createService(createExecutor());
    const discovery = await service.discover(postgresSource);

    expect(discovery).toMatchObject({
      sourceId: "postgres",
      integrationType: "postgres",
      category: "database",
    });
    expect(discovery.tables.map((table) => table.name)).toEqual([
      "orders",
      "customers",
    ]);
    expect(discovery.tables[1]?.columns[0]).toMatchObject({
      name: "id",
      primaryKey: true,
    });
  });

  it("runs PostgreSQL and Prometheus investigations through one service", async () => {
    generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("PostgreSQL SQL expert")) {
        return { text: "SELECT status, COUNT(*) AS count FROM orders GROUP BY status" };
      }

      if (prompt.includes("Prometheus PromQL expert")) {
        return { text: 'sum(rate(http_requests_total[5m]))' };
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    });

    const executeTool = createExecutor();
    const service = createService(executeTool);
    const results = await service.investigate(
      [postgresSource, prometheusSource],
      { customerId: "C-1001", service: "api" }
    );

    expect(Object.keys(results)).toEqual(["postgres", "metrics"]);
    expect(results.postgres).toMatchObject({
      sourceId: "postgres",
      integrationType: "postgres",
      category: "database",
      status: "success",
      query: "SELECT status, COUNT(*) AS count FROM orders GROUP BY status",
      data: [{ customer_id: "C-1001", status: "failed", count: 3 }],
    });
    expect(results.metrics).toMatchObject({
      sourceId: "metrics",
      integrationType: "prometheus",
      category: "metrics",
      status: "success",
      query: "sum(rate(http_requests_total[5m]))",
      data: {
        resultType: "matrix",
        result: [{ metric: { __name__: "http_requests_total" } }],
      },
    });
    expect(executeTool).toHaveBeenCalledWith("prom_range", {
      query: "sum(rate(http_requests_total[5m]))",
      start: expect.any(String),
      end: expect.any(String),
      step: "30s",
    });
  });

  it("isolates failures between the new integrations", async () => {
    generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("PostgreSQL SQL expert")) {
        return { text: "SELECT * FROM orders" };
      }

      return { text: "up" };
    });

    const executor = createExecutor();
    const service = createService(async (toolName, args) => {
      if (toolName === "query" && args?.sql === "SELECT * FROM orders") {
        throw new Error("PostgreSQL server unavailable");
      }

      return executor(toolName, args);
    });
    const results = await service.investigate(
      [postgresSource, prometheusSource],
      {}
    );

    expect(results.postgres).toMatchObject({
      status: "failed",
      data: null,
      error: "PostgreSQL server unavailable",
      integrationType: "postgres",
    });
    expect(results.metrics).toMatchObject({
      status: "success",
      integrationType: "prometheus",
    });
  });
});
