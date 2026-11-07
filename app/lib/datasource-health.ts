import { statSync } from "node:fs";
import { Client } from "pg";
import type { DataSourceConfig, DataSourceMap } from "./datasource.config";
import type {
  IntegrationType,
  SourceCategory,
} from "./datasource/datasource.types";

const DEFAULT_HEALTH_TIMEOUT_MS = 3_000;

export type DataSourceHealthStatus = "up" | "down" | "disabled";

export interface DataSourceHealth {
  readonly id: string;
  readonly name: string;
  readonly type: IntegrationType;
  readonly category: SourceCategory;
  readonly enabled: boolean;
  readonly status: DataSourceHealthStatus;
  readonly latencyMs: number;
  readonly detail: string;
}

export interface DataSourceHealthReport {
  readonly status: "ok" | "degraded" | "down";
  readonly checkedAt: string;
  readonly sources: readonly DataSourceHealth[];
}

export interface HealthCheckDependencies {
  readonly fetch?: typeof fetch;
  readonly checkPostgres?: (
    connection: string,
    timeoutMs: number
  ) => Promise<void>;
  readonly checkFile?: (path: string) => void;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || error.name;
  }

  return String(error);
}

function assertConnectionFile(path: string): void {
  const stats = statSync(/* turbopackIgnore: true */ path);

  if (!stats.isFile()) {
    throw new Error("Datasource connection path is not a file");
  }
}

async function queryPostgres(
  connection: string,
  timeoutMs: number
): Promise<void> {
  const client = new Client({
    connectionString: connection,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    application_name: "sre-agent-health",
  });

  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkSource(
  source: DataSourceConfig,
  dependencies: HealthCheckDependencies
): Promise<DataSourceHealth> {
  if (!source.enabled) {
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      category: source.category,
      enabled: false,
      status: "disabled",
      latencyMs: 0,
      detail: "Datasource is disabled",
    };
  }

  const startedAt = performance.now();

  try {
    if (source.type === "sqlite") {
      if (!source.connection) {
        throw new Error("SQLite connection path is not configured");
      }

      (dependencies.checkFile ?? assertConnectionFile)(source.connection);
    } else if (source.type === "postgres") {
      if (!source.connection) {
        throw new Error("PostgreSQL connection URL is not configured");
      }

      await (
        dependencies.checkPostgres ?? queryPostgres
      )(source.connection, DEFAULT_HEALTH_TIMEOUT_MS);
    } else if (source.type === "prometheus") {
      const baseUrl = source.env.PROMETHEUS_URL?.trim();

      if (!baseUrl) {
        throw new Error("PROMETHEUS_URL is not configured");
      }

      const healthUrl = new URL(
        "-/healthy",
        baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
      );
      const fetchImpl = dependencies.fetch ?? fetch;
      const response = await fetchImpl(healthUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(DEFAULT_HEALTH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Prometheus health endpoint returned HTTP ${response.status}`
        );
      }
    } else if (source.type === "sentry") {
      const baseUrl = source.env.SENTRY_HOST?.trim() || "https://sentry.io";
      const token = source.env.SENTRY_AUTH_TOKEN?.trim();
      const organizationSlug = source.env.SENTRY_ORG?.trim();

      if (!token) {
        throw new Error("SENTRY_AUTH_TOKEN is not configured");
      }

      if (!organizationSlug) {
        throw new Error("SENTRY_ORG is not configured");
      }

      const healthUrl = new URL(
        `api/0/organizations/${encodeURIComponent(organizationSlug)}/`,
        baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
      );
      const fetchImpl = dependencies.fetch ?? fetch;
      const response = await fetchImpl(healthUrl, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(DEFAULT_HEALTH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Sentry API returned HTTP ${response.status}`);
      }
    }

    return {
      id: source.id,
      name: source.name,
      type: source.type,
      category: source.category,
      enabled: true,
      status: "up",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      detail: "Datasource is reachable",
    };
  } catch (error) {
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      category: source.category,
      enabled: true,
      status: "down",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      detail: describeError(error),
    };
  }
}

export async function checkDataSourcesHealth(
  sources: DataSourceMap,
  dependencies: HealthCheckDependencies = {}
): Promise<DataSourceHealthReport> {
  const health = await Promise.all(
    Object.values(sources).map((source) =>
      checkSource(source, dependencies)
    )
  );
  const enabled = health.filter((source) => source.enabled);
  const up = enabled.filter((source) => source.status === "up");
  const status =
    enabled.length === 0 || up.length === enabled.length
      ? "ok"
      : up.length === 0
        ? "down"
        : "degraded";

  return {
    status,
    checkedAt: new Date().toISOString(),
    sources: health,
  };
}
