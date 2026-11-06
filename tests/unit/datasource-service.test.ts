import { describe, expect, it, vi } from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import type { DataSourceAdapter } from "@/app/lib/datasource/datasource.interface";
import { DataSourceRegistry } from "@/app/lib/datasource/datasource.registry";
import {
  DataSourceService,
  DEFAULT_SOURCE_CONCURRENCY,
} from "@/app/lib/datasource/datasource.service";
import type {
  AdapterQueryResult,
  DiscoveryResult,
} from "@/app/lib/datasource/datasource.types";
import type { ToolExecutor } from "@/app/lib/mcp/mcp.interface";
import type { RegistryModelId } from "@/app/lib/model.registry";

const model = "google:gemini-2.5-flash" as RegistryModelId;

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

function discovery(sourceConfig: DataSourceConfig): DiscoveryResult {
  return {
    sourceId: sourceConfig.id,
    sourceName: sourceConfig.name,
    integrationType: sourceConfig.type,
    category: sourceConfig.category,
    tables: [],
  };
}

function fakeAdapter(
  overrides: Partial<DataSourceAdapter> = {}
): DataSourceAdapter {
  return {
    type: "sqlite",
    discover: vi.fn(async (sourceConfig: DataSourceConfig) =>
      discovery(sourceConfig)
    ),
    query: vi.fn(
      async (): Promise<AdapterQueryResult> => ({
        data: { found: true },
        query: "SELECT 1",
      })
    ),
    ...overrides,
  };
}

function createService(
  adapter: DataSourceAdapter,
  executeTool: ToolExecutor = vi.fn(),
  concurrency?: number
): DataSourceService {
  return new DataSourceService({
    registry: new DataSourceRegistry().register(adapter),
    executeTool,
    model,
    concurrency,
  });
}

function delayedAdapter(delayMs = 10): {
  adapter: DataSourceAdapter;
  getMaxActive: () => number;
} {
  let active = 0;
  let maxActive = 0;
  const adapter = fakeAdapter({
    query: vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      active -= 1;
      return { data: { ok: true } };
    }),
  });

  return { adapter, getMaxActive: () => maxActive };
}

describe("DataSourceService.query", () => {
  it("normalizes adapter output into a SourceResult", async () => {
    const adapter = fakeAdapter();
    const executeTool = vi.fn<ToolExecutor>();
    const service = createService(adapter, executeTool);
    const database = source("database");

    const result = await service.query(database, { customerId: "C-1001" });

    expect(result).toMatchObject({
      sourceId: "database",
      sourceName: "database",
      integrationType: "sqlite",
      category: "database",
      status: "success",
      data: { found: true },
      query: "SELECT 1",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
    expect(adapter.query).toHaveBeenCalledWith(
      {
        source: database,
        params: { customerId: "C-1001" },
        model,
      },
      executeTool
    );
  });

  it("preserves partial adapter results", async () => {
    const service = createService(
      fakeAdapter({
        query: vi.fn(async (): Promise<AdapterQueryResult> => ({
          status: "partial",
          data: [{ id: 1 }],
          query: "SELECT * FROM records LIMIT 1",
        })),
      })
    );

    const result = await service.query(source("database"), {});

    expect(result.status).toBe("partial");
    expect(result.data).toEqual([{ id: 1 }]);
  });

  it("rejects disabled sources before resolving an adapter", async () => {
    const adapter = fakeAdapter();
    const service = createService(adapter);

    await expect(
      service.query(source("database", { enabled: false }), {})
    ).rejects.toMatchObject({
      name: "DataSourceConfigError",
      message: expect.stringContaining("disabled"),
    });
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("rejects sources whose integration type has no adapter", async () => {
    const service = new DataSourceService({
      registry: new DataSourceRegistry(),
      executeTool: vi.fn(),
      model,
    });

    await expect(service.query(source("metrics"), {})).rejects.toMatchObject({
      name: "DataSourceConfigError",
      message: 'No adapter registered for datasource type "sqlite"',
    });
  });

  it("resolves discovery through the adapter", async () => {
    const adapter = fakeAdapter();
    const service = createService(adapter);
    const database = source("database");

    const result = await service.discover(database);

    expect(result).toMatchObject({
      sourceId: "database",
      integrationType: "sqlite",
    });
    expect(adapter.discover).toHaveBeenCalledWith(database, expect.any(Function));
  });
});

describe("DataSourceService.investigate", () => {
  it("investigates only enabled sources and keys results by source id", async () => {
    const adapter = fakeAdapter();
    const service = createService(adapter);
    const database = source("database");
    const logs = source("logs");
    const cache = source("cache", { enabled: false });

    const results = await service.investigate(
      { database, logs, cache },
      { customerId: "C-1001" }
    );

    expect(Object.keys(results)).toEqual(["database", "logs"]);
    expect(results.database?.status).toBe("success");
    expect(results.logs?.status).toBe("success");
    expect(adapter.query).toHaveBeenCalledTimes(2);
  });

  it("normalizes one source failure without failing the other source", async () => {
    const adapter = fakeAdapter({
      query: vi.fn(async (input: Parameters<DataSourceAdapter["query"]>[0]) => {
        if (input.source.id === "logs") {
          throw new Error("logs MCP server is unavailable");
        }

        return { data: [{ customer_id: "C-1001" }], query: "SELECT * FROM records" };
      }),
    });
    const service = createService(adapter);

    const results = await service.investigate(
      [source("database"), source("logs")],
      { customerId: "C-1001" }
    );

    expect(results.database).toMatchObject({
      status: "success",
      data: [{ customer_id: "C-1001" }],
    });
    expect(results.logs).toMatchObject({
      status: "failed",
      data: null,
      error: "logs MCP server is unavailable",
    });
    expect(results.logs?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("normalizes an unsupported integration type into a failed result", async () => {
    const service = new DataSourceService({
      registry: new DataSourceRegistry(),
      executeTool: vi.fn(),
      model,
    });
    const metrics = source("metrics", {
      type: "prometheus",
      category: "metrics",
    });

    const results = await service.investigate([metrics], {});

    expect(results.metrics).toMatchObject({
      sourceId: "metrics",
      integrationType: "prometheus",
      category: "metrics",
      status: "failed",
      data: null,
      error: 'No adapter registered for datasource type "prometheus"',
    });
  });

  it("turns non-Error failures into an error string", async () => {
    const service = createService(
      fakeAdapter({
        query: vi.fn(async () => {
          throw "unexpected failure";
        }),
      })
    );

    const result = await service.investigateSource(source("database"), {});

    expect(result).toMatchObject({
      status: "failed",
      error: "unexpected failure",
    });
  });

  it("marks disabled investigated sources as failed", async () => {
    const adapter = fakeAdapter();
    const service = createService(adapter);

    const result = await service.investigateSource(
      source("database", { enabled: false }),
      {}
    );

    expect(result).toMatchObject({
      sourceId: "database",
      status: "failed",
      error: expect.stringContaining("disabled"),
    });
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("starts independent source investigations concurrently", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = fakeAdapter({
      query: vi.fn(async () => {
        started += 1;

        if (started === 2) {
          release();
        }

        await gate;
        return { data: { ok: true } };
      }),
    });
    const service = createService(adapter);

    const investigation = service.investigate(
      [source("database"), source("logs")],
      {}
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toBe(2);
    release();

    const results = await investigation;

    expect(Object.keys(results)).toEqual(["database", "logs"]);
  });

  it("bounds parallel source execution to the configured concurrency", async () => {
    const { adapter, getMaxActive } = delayedAdapter();
    const service = createService(adapter, vi.fn(), 2);
    const manySources = Array.from({ length: 6 }, (_, index) =>
      source(`source-${index}`)
    );

    const results = await service.investigate(manySources, {});

    expect(Object.keys(results)).toHaveLength(6);
    expect(getMaxActive()).toBe(2);
  });

  it("uses the default concurrency bound when none is configured", async () => {
    const { adapter, getMaxActive } = delayedAdapter();
    const service = createService(adapter);
    const manySources = Array.from({ length: 6 }, (_, index) =>
      source(`source-${index}`)
    );

    await service.investigate(manySources, {});

    expect(DEFAULT_SOURCE_CONCURRENCY).toBe(4);
    expect(getMaxActive()).toBe(DEFAULT_SOURCE_CONCURRENCY);
  });

  it("runs sequentially when concurrency is one", async () => {
    const { adapter, getMaxActive } = delayedAdapter(5);
    const service = createService(adapter, vi.fn(), 1);

    await service.investigate([source("database"), source("logs")], {});

    expect(getMaxActive()).toBe(1);
  });

  it("rejects invalid concurrency values", () => {
    const adapter = fakeAdapter();

    for (const concurrency of [0, -1, 1.5, Number.NaN]) {
      expect(() => createService(adapter, vi.fn(), concurrency)).toThrowError(
        expect.objectContaining({
          name: "DataSourceConfigError",
          message: expect.stringContaining("positive integer"),
        })
      );
    }
  });

  it("returns an empty result map when no sources are enabled", async () => {
    const adapter = fakeAdapter();
    const service = createService(adapter);

    const results = await service.investigate(
      [source("database", { enabled: false })],
      {}
    );

    expect(results).toEqual({});
    expect(adapter.query).not.toHaveBeenCalled();
  });
});
