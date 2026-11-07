import { describe, expect, it, vi } from "vitest";
import { PrometheusAdapter } from "@/app/lib/datasource/adapters/prometheus/prometheus.adapter";
import { SentryAdapter } from "@/app/lib/datasource/adapters/sentry/sentry.adapter";
import {
  POSTGRES_DIALECT,
  SqlAdapter,
} from "@/app/lib/datasource/adapters/sql/sql.adapter";
import type { DataSourceAdapter } from "@/app/lib/datasource/datasource.interface";
import {
  createDefaultDataSourceRegistry,
  DataSourceRegistry,
} from "@/app/lib/datasource/datasource.registry";
import type { IntegrationType } from "@/app/lib/datasource/datasource.types";

function fakeAdapter(type: IntegrationType): DataSourceAdapter {
  return {
    type,
    discover: vi.fn(),
    query: vi.fn(),
  };
}

describe("DataSourceRegistry", () => {
  it("registers and resolves adapters by integration type", () => {
    const adapter = fakeAdapter("sqlite");
    const registry = new DataSourceRegistry().register(adapter);

    expect(registry.resolve("sqlite")).toBe(adapter);
    expect(registry.has("sqlite")).toBe(true);
    expect(registry.registeredTypes).toEqual(["sqlite"]);
  });

  it("rejects duplicate adapters for the same integration type", () => {
    const registry = new DataSourceRegistry().register(fakeAdapter("sqlite"));

    expect(() => registry.register(fakeAdapter("sqlite"))).toThrowError(
      expect.objectContaining({
        name: "DataSourceConfigError",
        message: expect.stringContaining("already registered"),
      })
    );
  });

  it("reports an unregistered integration type clearly", () => {
    const registry = new DataSourceRegistry();

    expect(registry.has("prometheus")).toBe(false);
    expect(() => registry.resolve("prometheus")).toThrowError(
      expect.objectContaining({
        name: "DataSourceConfigError",
        message: 'No adapter registered for datasource type "prometheus"',
      })
    );
  });

  it("provides a default registry for SQLite, PostgreSQL, Prometheus, and Sentry", () => {
    const registry = createDefaultDataSourceRegistry();

    expect(registry.registeredTypes).toEqual([
      "sqlite",
      "postgres",
      "prometheus",
      "sentry",
    ]);
    expect(registry.resolve("sqlite")).toBeInstanceOf(SqlAdapter);
    expect(registry.resolve("sqlite").type).toBe("sqlite");
    expect(registry.resolve("postgres")).toBeInstanceOf(SqlAdapter);
    expect(registry.resolve("postgres").type).toBe(POSTGRES_DIALECT.type);
    expect(registry.resolve("prometheus")).toBeInstanceOf(PrometheusAdapter);
    expect(registry.resolve("prometheus").type).toBe("prometheus");
    expect(registry.resolve("sentry")).toBeInstanceOf(SentryAdapter);
    expect(registry.resolve("sentry").type).toBe("sentry");
    expect(() => registry.resolve("loki")).toThrowError(/loki/);
  });

  it("supports multiple integration types on one registry", () => {
    const registry = new DataSourceRegistry()
      .register(fakeAdapter("sqlite"))
      .register(fakeAdapter("prometheus"));

    expect(registry.registeredTypes).toEqual(["sqlite", "prometheus"]);
    expect(registry.resolve("prometheus").type).toBe("prometheus");
  });
});
