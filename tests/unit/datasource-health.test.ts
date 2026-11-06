import { describe, expect, it, vi } from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import {
  checkDataSourcesHealth,
  type HealthCheckDependencies,
} from "@/app/lib/datasource-health";

function source(overrides: Partial<DataSourceConfig> = {}): DataSourceConfig {
  return {
    id: "database",
    name: "database",
    type: "sqlite",
    category: "database",
    package: "mcp-sqlite",
    tools: {
      query: "database_query",
      listTables: "database_list_tables",
      describeTable: "database_get_table_schema",
    },
    env: {},
    connection: "/tmp/database.db",
    settings: { timeRangeMinutes: 60, stepSeconds: 60 },
    enabled: true,
    ...overrides,
  };
}

const postgres = source({
  id: "postgres",
  name: "postgres",
  type: "postgres",
  package: "@modelcontextprotocol/server-postgres",
  tools: { query: "postgres_query" },
  connection: "postgresql://user:secret@db:5432/app",
});

const prometheus = source({
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
  env: { PROMETHEUS_URL: "http://prometheus:9090" },
  connection: undefined,
});

describe("checkDataSourcesHealth", () => {
  it("reports disabled sources without checking them", async () => {
    const checkPostgres = vi.fn<NonNullable<HealthCheckDependencies["checkPostgres"]>>();
    const report = await checkDataSourcesHealth(
      { postgres: { ...postgres, enabled: false } },
      { checkPostgres }
    );

    expect(report.status).toBe("ok");
    expect(report.sources).toEqual([
      expect.objectContaining({
        id: "postgres",
        enabled: false,
        status: "disabled",
        latencyMs: 0,
      }),
    ]);
    expect(checkPostgres).not.toHaveBeenCalled();
  });

  it("checks SQLite connection files", async () => {
    const checkFile = vi.fn();
    const report = await checkDataSourcesHealth(
      { database: source() },
      { checkFile }
    );

    expect(checkFile).toHaveBeenCalledWith("/tmp/database.db");
    expect(report.sources[0]).toMatchObject({
      id: "database",
      enabled: true,
      status: "up",
    });
  });

  it("reports a degraded system when one enabled source is down", async () => {
    const checkPostgres = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => {
      throw new Error("Prometheus connection refused");
    }) as unknown as typeof fetch;

    const report = await checkDataSourcesHealth(
      { postgres, metrics: prometheus },
      { checkPostgres, fetch: fetchMock }
    );

    expect(report.status).toBe("degraded");
    expect(report.sources).toEqual([
      expect.objectContaining({ id: "postgres", status: "up" }),
      expect.objectContaining({
        id: "metrics",
        status: "down",
        detail: "Prometheus connection refused",
      }),
    ]);
    expect(checkPostgres).toHaveBeenCalledWith(
      "postgresql://user:secret@db:5432/app",
      3000
    );
    const requestedUrl = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as URL;
    expect(requestedUrl.toString()).toBe("http://prometheus:9090/-/healthy");
  });

  it("reports down when every enabled source fails", async () => {
    const report = await checkDataSourcesHealth(
      { database: source(), metrics: prometheus },
      {
        checkFile: () => {
          throw new Error("database file is missing");
        },
        fetch: vi.fn(async () => ({ ok: false, status: 503 })) as
          unknown as typeof fetch,
      }
    );

    expect(report.status).toBe("down");
    expect(report.sources.map((entry) => entry.status)).toEqual([
      "down",
      "down",
    ]);
  });

  it("reports Prometheus HTTP failures", async () => {
    const report = await checkDataSourcesHealth(
      { metrics: prometheus },
      {
        fetch: vi.fn(async () => ({ ok: false, status: 503 })) as
          unknown as typeof fetch,
      }
    );

    expect(report.sources[0]).toMatchObject({
      status: "down",
      detail: "Prometheus health endpoint returned HTTP 503",
    });
  });
});
