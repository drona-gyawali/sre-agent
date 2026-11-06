import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DataSourceConfig,
  DataSourceMap,
} from "@/app/lib/datasource.config";
import type { DataSourceService } from "@/app/lib/datasource/datasource.service";
import type { SourceResult } from "@/app/lib/datasource/datasource.types";
import { buildDiagnosticGraph } from "@/app/lib/graph";
import {
  LlmInvestigationPlanner,
  type InvestigationPlanner,
} from "@/app/lib/investigation/planner";
import type { McpToolResult, ToolExecutor } from "@/app/lib/mcp/mcp.interface";
import type { RegistryModelId } from "@/app/lib/model.registry";
import {
  createGenerateReportNode,
  createInvestigateSourcesNode,
  type DiagnosticStateValue,
} from "@/app/lib/utils";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({ generateText }));
vi.mock("@/app/lib/model.registry", () => ({
  getModel: vi.fn(() => "test-model"),
}));

const model = "google:gemini-2.5-flash" as RegistryModelId;

const sources: DataSourceMap = {
  database: {
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
  },
  logs: {
    id: "logs",
    name: "logs",
    type: "sqlite",
    category: "logs",
    package: "mcp-sqlite",
    tools: {
      query: "logs_query",
      listTables: "logs_list_tables",
      describeTable: "logs_get_table_schema",
    },
    env: {},
    connection: "/tmp/logs.db",
    settings: { timeRangeMinutes: 60, stepSeconds: 60 },
    enabled: true,
  },
};

const successResult: SourceResult = {
  sourceId: "database",
  sourceName: "db",
  integrationType: "sqlite",
  category: "database",
  status: "success",
  data: [{ customer_id: "C-1001", status: "failed" }],
  query: "SELECT * FROM records WHERE customer_id = 'C-1001'",
  durationMs: 12,
};

const failedResult: SourceResult = {
  sourceId: "logs",
  sourceName: "logs",
  integrationType: "sqlite",
  category: "logs",
  status: "failed",
  data: null,
  error: "logs MCP server is unavailable",
  durationMs: 8,
};

function state(
  overrides: Partial<DiagnosticStateValue> = {}
): DiagnosticStateValue {
  return {
    issueNumber: "1",
    repo: "acme/payments",
    model,
    issueDescription: "Payments failed for C-1001",
    identifiers: { customerId: "C-1001" },
    sourceResults: {},
    report: "",
    ...overrides,
  };
}

function fakeService(
  results: Record<string, SourceResult>
): DataSourceService {
  return {
    investigate: vi.fn(async () => results),
  } as unknown as DataSourceService;
}

function fakePlanner(
  selectedSources: readonly DataSourceConfig[]
): InvestigationPlanner {
  return {
    selectSources: vi.fn(async () => selectedSources),
  };
}

function toolResult(text: string, toolName = "test_tool"): McpToolResult {
  return {
    toolName,
    text,
    content: [{ type: "text", text }],
  };
}

beforeEach(() => {
  generateText.mockReset();
});

describe("investigate_sources node", () => {
  it("plans a source subset and investigates only the selected sources", async () => {
    const dataSourceService = fakeService({ logs: failedResult });
    const planner = fakePlanner([sources.logs!]);
    const node = createInvestigateSourcesNode({
      executeTool: vi.fn<ToolExecutor>(),
      sources,
      dataSourceService,
      planner,
    });

    const update = await node(state());

    expect(planner.selectSources).toHaveBeenCalledWith({
      issueDescription: "Payments failed for C-1001",
      identifiers: { customerId: "C-1001" },
      sources,
    });
    expect(dataSourceService.investigate).toHaveBeenCalledWith(
      [sources.logs],
      { customerId: "C-1001" }
    );
    expect(update).toEqual({
      sourceResults: {
        logs: failedResult,
      },
    });
  });
});

describe("generate_report node", () => {
  it("includes normalized source results and source failures in the prompt", async () => {
    generateText.mockResolvedValue({ text: "Diagnostic report" });

    const node = createGenerateReportNode();
    const update = await node(
      state({
        sourceResults: {
          database: successResult,
          logs: failedResult,
        },
      })
    );

    expect(update).toEqual({ report: "Diagnostic report" });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        prompt: expect.stringContaining("Status: success (12ms)"),
      })
    );

    const prompt = generateText.mock.calls[0]?.[0]?.prompt as string;

    expect(prompt).toContain("[database] db (database, sqlite)");
    expect(prompt).toContain("[logs] logs (logs, sqlite)");
    expect(prompt).toContain("Status: failed (8ms)");
    expect(prompt).toContain("Error: logs MCP server is unavailable");
    expect(prompt).toContain('Evidence: [{"customer_id":"C-1001"');
    expect(prompt).not.toContain("DB Records");
    expect(prompt).not.toContain("Logs:");
  });

  it("states explicitly when no sources were selected", async () => {
    generateText.mockResolvedValue({ text: "Diagnostic report" });

    const node = createGenerateReportNode();
    await node(state({ sourceResults: {} }));

    const prompt = generateText.mock.calls[0]?.[0]?.prompt as string;

    expect(prompt).toContain(
      "No data sources were selected or enabled for this investigation."
    );
  });
});

describe("buildDiagnosticGraph", () => {
  it("uses one generic investigation node instead of database/log nodes", async () => {
    const graph = buildDiagnosticGraph({
      executeTool: vi.fn<ToolExecutor>(),
      sources,
      dataSourceService: fakeService({}),
      planner: fakePlanner(Object.values(sources)),
    });
    const drawable = await graph.getGraphAsync();
    const nodeIds = Object.keys(drawable.nodes);
    const edges = drawable.edges.map((edge) => `${edge.source}->${edge.target}`);

    expect(nodeIds).toEqual(
      expect.arrayContaining([
        "fetch_issue",
        "extract_identifiers",
        "investigate_sources",
        "generate_report",
      ])
    );
    expect(nodeIds).not.toContain("query_database");
    expect(nodeIds).not.toContain("check_logs");
    expect(edges).toEqual(
      expect.arrayContaining([
        "extract_identifiers->investigate_sources",
        "investigate_sources->generate_report",
      ])
    );
  });

  it("runs the full workflow and stores sourceResults in graph state", async () => {
    const executeTool: ToolExecutor = async (toolName) => {
      expect(toolName).toBe("get_issue");
      return toolResult("Payments are failing for customer C-1001", toolName);
    };
    const dataSourceService = fakeService({ logs: failedResult });
    generateText
      .mockResolvedValueOnce({ text: '{"customerId":"C-1001"}' })
      .mockResolvedValueOnce({ text: '{"sources":["logs"]}' })
      .mockResolvedValueOnce({ text: "Final diagnostic report" });

    const graph = buildDiagnosticGraph({
      executeTool,
      sources,
      dataSourceService,
      planner: new LlmInvestigationPlanner({ model }),
    });
    const result = await graph.invoke({
      issueNumber: "1",
      repo: "acme/payments",
      model,
    });

    expect(result.issueDescription).toContain("Payments are failing");
    expect(result.identifiers).toEqual({ customerId: "C-1001" });
    expect(result.sourceResults).toEqual({
      logs: failedResult,
    });
    expect(result.report).toBe("Final diagnostic report");
    expect(dataSourceService.investigate).toHaveBeenCalledWith(
      [sources.logs],
      { customerId: "C-1001" }
    );
  });
});

describe("buildDiagnosticGraph with new integrations", () => {
  it("keeps the same graph nodes for PostgreSQL and Prometheus sources", async () => {
    const integratedSources: DataSourceMap = {
      postgres: {
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
      },
      metrics: {
        id: "metrics",
        name: "platform metrics",
        type: "prometheus",
        category: "metrics",
        package: "prometheus-mcp-server",
        tools: { query: "prom_query", rangeQuery: "prom_range" },
        env: { PROMETHEUS_URL: "http://prometheus:9090" },
        settings: { timeRangeMinutes: 15, stepSeconds: 30 },
        enabled: true,
      },
    };

    const graph = buildDiagnosticGraph({
      executeTool: vi.fn<ToolExecutor>(),
      sources: integratedSources,
      dataSourceService: fakeService({}),
      planner: fakePlanner(Object.values(integratedSources)),
    });
    const drawable = await graph.getGraphAsync();
    const nodeIds = Object.keys(drawable.nodes);

    expect(nodeIds).toEqual(
      expect.arrayContaining([
        "fetch_issue",
        "extract_identifiers",
        "investigate_sources",
        "generate_report",
      ])
    );
    expect(nodeIds).not.toContain("query_postgres");
    expect(nodeIds).not.toContain("query_prometheus");
  });
});
