import type { DataSourceConfig } from "../datasource.config";
import type { ToolExecutor } from "../mcp/mcp.interface";
import type { RegistryModelId } from "../model.registry";
import type {
  AdapterQueryResult,
  DiscoveryResult,
  IntegrationType,
} from "./datasource.types";

export interface QueryInput {
  readonly source: DataSourceConfig;
  readonly params: Readonly<Record<string, unknown>>;
  readonly issueDescription?: string;
  readonly model: RegistryModelId;
}

export interface DataSourceAdapter {
  readonly type: IntegrationType;

  discover(
    source: DataSourceConfig,
    executor: ToolExecutor
  ): Promise<DiscoveryResult>;

  query(
    input: QueryInput,
    executor: ToolExecutor
  ): Promise<AdapterQueryResult>;
}
