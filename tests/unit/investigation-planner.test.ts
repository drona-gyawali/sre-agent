import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSourceConfig, DataSourceMap } from "@/app/lib/datasource.config";
import {
  LlmInvestigationPlanner,
  type SourceSelectionInput,
} from "@/app/lib/investigation/planner";
import type { RegistryModelId } from "@/app/lib/model.registry";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({ generateText }));
vi.mock("@/app/lib/model.registry", () => ({
  getModel: vi.fn(() => "test-model"),
}));

const model = "google:gemini-2.5-flash" as RegistryModelId;
const planner = new LlmInvestigationPlanner({ model });

function source(
  id: string,
  overrides: Partial<DataSourceConfig> = {}
): DataSourceConfig {
  return {
    id,
    name: id,
    type: "sqlite",
    category: id === "logs" ? "logs" : "database",
    package: "mcp-sqlite",
    tools: {
      query: `${id}_query`,
      listTables: `${id}_list_tables`,
      describeTable: `${id}_get_table_schema`,
    },
    env: {},
    connection: `/tmp/${id}.db`,
    settings: { timeRangeMinutes: 60, stepSeconds: 60 },
    enabled: true,
    ...overrides,
  };
}

function input(sources: DataSourceMap): SourceSelectionInput {
  return {
    issueDescription: "Payments are failing for customer C-1001",
    identifiers: { customerId: "C-1001" },
    sources,
  };
}

beforeEach(() => {
  generateText.mockReset();
});

describe("LlmInvestigationPlanner", () => {
  it("returns no sources without calling the model when everything is disabled", async () => {
    const result = await planner.selectSources(
      input({
        database: source("database", { enabled: false }),
        logs: source("logs", { enabled: false }),
      })
    );

    expect(result).toEqual([]);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("selects only valid enabled source ids in configuration order", async () => {
    generateText.mockResolvedValue({
      text: '{"sources":["logs","missing","logs","database"]}',
    });

    const result = await planner.selectSources(
      input({
        database: source("database"),
        logs: source("logs"),
        metrics: source("metrics", { enabled: false }),
      })
    );

    expect(result.map((entry) => entry.id)).toEqual(["database", "logs"]);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        prompt: expect.stringContaining("Payments are failing for customer C-1001"),
      })
    );

    const prompt = generateText.mock.calls[0]?.[0]?.prompt as string;

    expect(prompt).toContain('"customerId":"C-1001"');
    expect(prompt).toContain("id: database");
    expect(prompt).toContain("id: logs");
    expect(prompt).not.toContain("id: metrics");
  });

  it("accepts a fenced JSON array response", async () => {
    generateText.mockResolvedValue({
      text: '```json\n[" logs "]\n```',
    });

    const result = await planner.selectSources(
      input({ database: source("database"), logs: source("logs") })
    );

    expect(result.map((entry) => entry.id)).toEqual(["logs"]);
  });

  it("falls back to all enabled sources when the model returns invalid JSON", async () => {
    generateText.mockResolvedValue({ text: "I think logs are relevant." });

    const result = await planner.selectSources(
      input({ database: source("database"), logs: source("logs") })
    );

    expect(result.map((entry) => entry.id)).toEqual(["database", "logs"]);
  });

  it("falls back to all enabled sources when the model call fails", async () => {
    generateText.mockRejectedValue(new Error("model unavailable"));

    const result = await planner.selectSources(
      input({ database: source("database"), logs: source("logs") })
    );

    expect(result.map((entry) => entry.id)).toEqual(["database", "logs"]);
  });

  it("falls back when the model selects no enabled source", async () => {
    generateText.mockResolvedValue({
      text: '{"sources":["disabled-source","unknown"]}',
    });

    const result = await planner.selectSources(
      input({
        database: source("database"),
        logs: source("logs"),
        cache: source("cache", { enabled: false }),
      })
    );

    expect(result.map((entry) => entry.id)).toEqual(["database", "logs"]);
  });

  it("falls back when the model returns an empty selection", async () => {
    generateText.mockResolvedValue({ text: '{"sources":[]}' });

    const result = await planner.selectSources(input({ logs: source("logs") }));

    expect(result.map((entry) => entry.id)).toEqual(["logs"]);
  });
});
