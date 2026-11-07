import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DataSourceConfig, DataSourceMap } from "@/app/lib/datasource.config";
import { createDefaultDataSourceRegistry } from "@/app/lib/datasource/datasource.registry";
import { DataSourceService } from "@/app/lib/datasource/datasource.service";
import { checkDataSourcesHealth } from "@/app/lib/datasource-health";
import { buildDiagnosticGraph } from "@/app/lib/graph";
import { LlmInvestigationPlanner } from "@/app/lib/investigation/planner";
import { McpSession } from "@/app/lib/mcp/mcp-manager";
import { buildMcpServerConfigs } from "@/app/lib/mcp/mcp-servers";
import type { McpToolResult } from "@/app/lib/mcp/mcp.interface";
import type { RegistryModelId } from "@/app/lib/model.registry";

const runRealIntegration = process.env.RUN_REAL_INTEGRATION === "1";
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const composeFile = fileURLToPath(
  new URL("./fixtures/docker-compose.yml", import.meta.url)
);
const postgresUrl = "postgresql://sre_agent:sre_agent@localhost:55432/sre_agent";
const prometheusUrl = "http://localhost:19090";
const pushgatewayUrl = "http://localhost:19091";
const sentryUrl = "http://localhost:19094";
const sentryAuthToken = "sntryu_integration";
const model = (process.env.INTEGRATION_MODEL ??
  "google:gemini-3.5-flash-lite") as RegistryModelId;

const postgresSource: DataSourceConfig = {
  id: "postgres",
  name: "postgres",
  type: "postgres",
  category: "database",
  package: "@modelcontextprotocol/server-postgres",
  tools: { query: "postgres_query" },
  env: {},
  connection: postgresUrl,
  settings: { timeRangeMinutes: 60, stepSeconds: 60 },
  enabled: true,
};

const prometheusSource: DataSourceConfig = {
  id: "metrics",
  name: "metrics",
  type: "prometheus",
  category: "metrics",
  package: "prometheus-mcp-server",
  tools: {
    query: "metrics_prom_query",
    rangeQuery: "metrics_prom_range",
    discover: "metrics_prom_discover",
  },
  env: { PROMETHEUS_URL: prometheusUrl },
  settings: { timeRangeMinutes: 15, stepSeconds: 15 },
  enabled: true,
};

const sentrySource: DataSourceConfig = {
  id: "sentry",
  name: "sentry",
  type: "sentry",
  category: "error_tracking",
  package: "@sentry/mcp-server",
  tools: {
    query: "sentry_search_issues",
    discover: "sentry_find_projects",
  },
  env: {
    SENTRY_AUTH_TOKEN: sentryAuthToken,
    SENTRY_ORG: "acme",
    SENTRY_PROJECT: "payments",
    SENTRY_HOST: sentryUrl,
  },
  settings: { timeRangeMinutes: 60, stepSeconds: 60 },
  enabled: true,
};

const sources: DataSourceMap = {
  postgres: postgresSource,
  metrics: prometheusSource,
  sentry: sentrySource,
};

let session: McpSession | undefined;
let service: DataSourceService | undefined;

function loadLocalEnvironment(): void {
  const envPath = resolve(repoRoot, ".env");

  if (
    !process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
    existsSync(envPath)
  ) {
    process.loadEnvFile(envPath);
  }
}

function compose(args: string[]): string {
  return execFileSync(
    "docker",
    ["compose", "-f", composeFile, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 180_000,
    }
  );
}

async function pushTestMetric(): Promise<void> {
  const response = await fetch(
    `${pushgatewayUrl}/metrics/job/sre-agent-integration`,
    {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: [
        "# TYPE sre_agent_http_requests_total counter",
        'sre_agent_http_requests_total{service="checkout",status="500"} 42',
        'sre_agent_http_requests_total{service="checkout",status="200"} 1000',
        "# TYPE sre_agent_request_duration_seconds gauge",
        'sre_agent_request_duration_seconds{service="checkout"} 0.87',
        "",
      ].join("\n"),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Unable to push Prometheus test metrics: ${response.status} ${response.statusText}`
    );
  }
}

async function waitForPrometheusMetric(): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const query = encodeURIComponent("sre_agent_http_requests_total");
      const response = await fetch(
        `${prometheusUrl}/api/v1/query?query=${query}`
      );
      const payload = (await response.json()) as {
        status?: string;
        data?: { result?: unknown[] };
      };

      if (payload.status === "success" && payload.data?.result?.length) {
        return;
      }
    } catch {
      // The service may still be starting.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  throw new Error("Prometheus did not scrape the pushed test metric");
}

function requireSession(): McpSession {
  if (!session) throw new Error("Real MCP session is not initialized");
  return session;
}

function requireService(): DataSourceService {
  if (!service) throw new Error("Real datasource service is not initialized");
  return service;
}

function toolResult(text: string, toolName = "get_issue"): McpToolResult {
  return { toolName, text, content: [{ type: "text", text }] };
}

describe.skipIf(!runRealIntegration)(
  "Real PostgreSQL, Prometheus, and Sentry integration",
  () => {
    beforeAll(async () => {
      loadLocalEnvironment();

      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        throw new Error(
          "GOOGLE_GENERATIVE_AI_API_KEY is required for real integration tests"
        );
      }

      try {
        compose(["down", "-v", "--remove-orphans"]);
      } catch {
        // A clean test environment may not have any containers yet.
      }

      compose(["up", "-d", "--wait", "--wait-timeout", "120"]);
      await pushTestMetric();
      await waitForPrometheusMetric();

      session = await McpSession.create(
        buildMcpServerConfigs(sources, { includeGithub: false }),
        { connectTimeoutMs: 120_000, toolTimeoutMs: 60_000 }
      );
      service = new DataSourceService({
        registry: createDefaultDataSourceRegistry(),
        executeTool: session.executeTool,
        model,
      });
    }, 300_000);

    afterAll(async () => {
      await session?.close().catch(() => undefined);
      compose(["down", "-v", "--remove-orphans"]);
    });

    it("connects to the real PostgreSQL, Prometheus, and Sentry MCP servers", () => {
      const toolNames = requireSession().tools.map((tool) => tool.name);

      expect(toolNames).toEqual(
        expect.arrayContaining([
          "postgres_query",
          "metrics_prom_query",
          "metrics_prom_range",
          "metrics_prom_discover",
          "sentry_search_issues",
          "sentry_find_projects",
        ])
      );
    });

    it("discovers the real PostgreSQL schema through the MCP server", async () => {
      const discovery = await requireService().discover(postgresSource);
      const tables = discovery.tables.map((table) => table.name).sort();
      const orders = discovery.tables.find((table) => table.name === "orders");

      expect(tables).toEqual(["customers", "orders"]);
      expect(orders?.columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "id",
          "customer_id",
          "transaction_id",
          "status",
          "amount",
          "created_at",
        ])
      );
      expect(orders?.columns.find((column) => column.name === "id")).toMatchObject({
        primaryKey: true,
        notNull: true,
      });
      expect(orders?.columns.find((column) => column.name === "customer_id"))
        .toMatchObject({ notNull: true });
    }, 60_000);

    it("discovers real Prometheus metrics through the MCP server", async () => {
      const discovery = await requireService().discover(prometheusSource);

      expect(discovery.metrics).toEqual(
        expect.arrayContaining([
          "up",
          "sre_agent_http_requests_total",
          "sre_agent_request_duration_seconds",
        ])
      );
    }, 60_000);

    it("discovers real Sentry projects through the MCP server", async () => {
      const discovery = await requireService().discover(sentrySource);

      expect(discovery).toMatchObject({
        sourceId: "sentry",
        integrationType: "sentry",
        category: "error_tracking",
      });
      expect(discovery.projects).toEqual(["payments"]);
    }, 60_000);

    it("reports real PostgreSQL, Prometheus, and Sentry health", async () => {
      const report = await checkDataSourcesHealth({
        postgres: postgresSource,
        metrics: prometheusSource,
        sentry: sentrySource,
      });

      expect(report.status).toBe("ok");
      expect(report.sources).toEqual([
        expect.objectContaining({
          id: "postgres",
          enabled: true,
          status: "up",
        }),
        expect.objectContaining({
          id: "metrics",
          enabled: true,
          status: "up",
        }),
        expect.objectContaining({
          id: "sentry",
          enabled: true,
          status: "up",
        }),
      ]);
    }, 30_000);

    it("generates and executes a real SQL query with Gemini", { retry: 2, timeout: 120_000 }, async () => {
      const result = await requireService().query(postgresSource, {
        customerId: "C-1001",
        status: "failed",
      });

      expect(result).toMatchObject({
        sourceId: "postgres",
        integrationType: "postgres",
        category: "database",
        status: "success",
      });
      expect(result.query?.toLowerCase()).toContain("orders");
      expect(Array.isArray(result.data)).toBe(true);
      expect((result.data as unknown[]).length).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("generates and executes a real PromQL range query with Gemini", { retry: 2, timeout: 120_000 }, async () => {
      const result = await requireService().query(prometheusSource, {
        metric: "sre_agent_http_requests_total",
        service: "checkout",
        status: "500",
      });
      const data = result.data as {
        status?: string;
        data?: { result?: unknown[] };
      };

      expect(result).toMatchObject({
        sourceId: "metrics",
        integrationType: "prometheus",
        category: "metrics",
        status: "success",
      });
      expect(result.query).toContain("sre_agent_http_requests_total");
      expect(data.status).toBe("success");
      expect(data.data?.result?.length).toBeGreaterThan(0);
    });

    it("generates and executes a real Sentry issue search with Gemini", { retry: 2, timeout: 120_000 }, async () => {
      const result = await requireService().query(sentrySource, {
        customerId: "C-1001",
        errorCode: "card_declined",
        service: "checkout",
      });
      const data = result.data as {
        query?: string;
        issues?: Array<{ shortId?: string; title?: string }>;
      };

      expect(result).toMatchObject({
        sourceId: "sentry",
        integrationType: "sentry",
        category: "error_tracking",
        status: "success",
      });
      expect(result.query?.trim().length).toBeGreaterThan(0);
      expect(data.issues?.length).toBeGreaterThan(0);
      expect(data.issues?.[0]).toMatchObject({
        shortId: "PAY-1",
        title: expect.stringContaining("C-1001"),
      });
    });

    it("runs the diagnostic graph end to end with real datasources", { retry: 3, timeout: 240_000 }, async () => {
      const issueText =
        "Payment failures for customer C-1001. Checkout returns 500 errors; " +
        "the orders database shows failed transactions and Prometheus shows " +
        "HTTP 500 requests.";

      const graph = buildDiagnosticGraph({
        executeTool: async (toolName, args) => {
          if (toolName === "get_issue") {
            return toolResult(issueText);
          }

          return requireSession().executeTool(toolName, args);
        },
        sources,
        dataSourceService: requireService(),
        planner: new LlmInvestigationPlanner({ model }),
      });
      const result = await graph.invoke({
        issueNumber: "1",
        repo: "acme/payments",
        model,
      });

      expect(Object.keys(result.sourceResults ?? {}).length).toBeGreaterThan(0);
      expect(result.identifiers).toMatchObject({ customerId: "C-1001" });
      expect(result.report?.trim().length).toBeGreaterThan(0);
    });
  }
);
