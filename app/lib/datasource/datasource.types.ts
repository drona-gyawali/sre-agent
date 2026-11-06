export const INTEGRATION_TYPES = [
  "sqlite",
  "postgres",
  "mysql",
  "clickhouse",
  "prometheus",
  "loki",
  "sentry",
] as const;

export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const SOURCE_CATEGORIES = [
  "database",
  "logs",
  "metrics",
  "error_tracking",
] as const;

export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export type SourceStatus = "success" | "partial" | "failed";

export interface DiscoveryColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly defaultValue: unknown;
}

export interface DiscoveryTable {
  readonly name: string;
  readonly columns: readonly DiscoveryColumn[];
}

export interface DiscoveryResult {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly integrationType: IntegrationType;
  readonly category: SourceCategory;
  readonly tables: readonly DiscoveryTable[];
  readonly metrics?: readonly string[];
}

export interface SourceResult {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly integrationType: IntegrationType;
  readonly category: SourceCategory;
  readonly status: SourceStatus;
  readonly data: unknown;
  readonly query?: string;
  readonly error?: string;
  readonly durationMs: number;
}

export interface AdapterQueryResult {
  readonly status?: Exclude<SourceStatus, "failed">;
  readonly data: unknown;
  readonly query?: string;
}
