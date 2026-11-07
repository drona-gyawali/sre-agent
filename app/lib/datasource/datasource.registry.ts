import { DataSourceConfigError } from "../mcp/mcp.errors";
import { PrometheusAdapter } from "./adapters/prometheus/prometheus.adapter";
import { SentryAdapter } from "./adapters/sentry/sentry.adapter";
import {
  SqlAdapter,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
} from "./adapters/sql/sql.adapter";
import type { DataSourceAdapter } from "./datasource.interface";
import type { IntegrationType } from "./datasource.types";

export class DataSourceRegistry {
  private readonly adapters = new Map<IntegrationType, DataSourceAdapter>();

  register(adapter: DataSourceAdapter): this {
    if (this.adapters.has(adapter.type)) {
      throw new DataSourceConfigError(
        `An adapter is already registered for datasource type "${adapter.type}"`
      );
    }

    this.adapters.set(adapter.type, adapter);
    return this;
  }

  resolve(type: string): DataSourceAdapter {
    const adapter = this.adapters.get(type as IntegrationType);

    if (!adapter) {
      throw new DataSourceConfigError(
        `No adapter registered for datasource type "${type}"`
      );
    }

    return adapter;
  }

  has(type: string): boolean {
    return this.adapters.has(type as IntegrationType);
  }

  get registeredTypes(): readonly IntegrationType[] {
    return [...this.adapters.keys()];
  }
}

export function createDefaultDataSourceRegistry(): DataSourceRegistry {
  return new DataSourceRegistry()
    .register(new SqlAdapter(SQLITE_DIALECT))
    .register(new SqlAdapter(POSTGRES_DIALECT))
    .register(new PrometheusAdapter())
    .register(new SentryAdapter());
}
