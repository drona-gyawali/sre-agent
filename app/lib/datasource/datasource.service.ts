import type { DataSourceConfig, DataSourceMap } from "../datasource.config";
import { DataSourceConfigError } from "../mcp/mcp.errors";
import type { ToolExecutor } from "../mcp/mcp.interface";
import type { RegistryModelId } from "../model.registry";
import type { DataSourceAdapter } from "./datasource.interface";
import type { DataSourceRegistry } from "./datasource.registry";
import type {
  AdapterQueryResult,
  DiscoveryResult,
  SourceResult,
} from "./datasource.types";

export const DEFAULT_SOURCE_CONCURRENCY = 4;

export interface DataSourceServiceOptions {
  readonly registry: DataSourceRegistry;
  readonly executeTool: ToolExecutor;
  readonly model: RegistryModelId;
  readonly concurrency?: number;
}

function resolveConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SOURCE_CONCURRENCY;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new DataSourceConfigError(
      "Datasource investigation concurrency must be a positive integer"
    );
  }

  return value;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || error.name;
  }

  return String(error);
}

function buildSuccessResult(
  source: DataSourceConfig,
  result: AdapterQueryResult,
  durationMs: number
): SourceResult {
  return {
    sourceId: source.id,
    sourceName: source.name,
    integrationType: source.type,
    category: source.category,
    status: result.status ?? "success",
    data: result.data,
    query: result.query,
    durationMs,
  };
}

function buildFailureResult(
  source: DataSourceConfig,
  error: unknown,
  durationMs: number
): SourceResult {
  return {
    sourceId: source.id,
    sourceName: source.name,
    integrationType: source.type,
    category: source.category,
    status: "failed",
    data: null,
    error: describeError(error),
    durationMs,
  };
}

export class DataSourceService {
  private readonly registry: DataSourceRegistry;
  private readonly executeTool: ToolExecutor;
  private readonly model: RegistryModelId;
  private readonly concurrency: number;

  constructor(options: DataSourceServiceOptions) {
    this.registry = options.registry;
    this.executeTool = options.executeTool;
    this.model = options.model;
    this.concurrency = resolveConcurrency(options.concurrency);
  }

  private resolveAdapter(source: DataSourceConfig): DataSourceAdapter {
    return this.registry.resolve(source.type);
  }

  private requireEnabled(source: DataSourceConfig): void {
    if (!source.enabled) {
      throw new DataSourceConfigError(
        `Datasource "${source.id}" is disabled and cannot be queried`
      );
    }
  }

  private executeQuery(
    source: DataSourceConfig,
    params: Readonly<Record<string, unknown>>,
    issueDescription?: string
  ): Promise<AdapterQueryResult> {
    const adapter = this.resolveAdapter(source);

    return adapter.query(
      {
        source,
        params,
        issueDescription,
        model: this.model,
      },
      this.executeTool
    );
  }

  async discover(source: DataSourceConfig): Promise<DiscoveryResult> {
    return this.resolveAdapter(source).discover(source, this.executeTool);
  }

  async query(
    source: DataSourceConfig,
    params: Readonly<Record<string, unknown>>,
    issueDescription?: string
  ): Promise<SourceResult> {
    this.requireEnabled(source);
    const startedAt = performance.now();
    const result = await this.executeQuery(source, params, issueDescription);

    return buildSuccessResult(source, result, elapsedSince(startedAt));
  }

  async investigateSource(
    source: DataSourceConfig,
    params: Readonly<Record<string, unknown>>,
    issueDescription?: string
  ): Promise<SourceResult> {
    const startedAt = performance.now();

    try {
      this.requireEnabled(source);
      const result = await this.executeQuery(source, params, issueDescription);

      return buildSuccessResult(source, result, elapsedSince(startedAt));
    } catch (error) {
      return buildFailureResult(source, error, elapsedSince(startedAt));
    }
  }

  async investigate(
    sources: DataSourceMap | readonly DataSourceConfig[],
    params: Readonly<Record<string, unknown>>,
    issueDescription?: string
  ): Promise<Record<string, SourceResult>> {
    const configured = Array.isArray(sources)
      ? sources
      : Object.values(sources);
    const enabled = configured.filter((source) => source.enabled);
    const results = await mapWithConcurrency(
      enabled,
      this.concurrency,
      (source) => this.investigateSource(source, params, issueDescription)
    );

    return Object.fromEntries(
      results.map((result) => [result.sourceId, result])
    );
  }
}
