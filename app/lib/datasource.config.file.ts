import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DataSourceConfigError } from "./mcp/mcp.errors";
import {
  parseDataSources,
  type DataSourceMap,
  type ParseDataSourcesOptions,
} from "./datasource.config";

export interface LoadDataSourcesOptions extends ParseDataSourcesOptions {
  readonly configPath?: string;
}

export function loadDataSources(
  options: LoadDataSourcesOptions = {}
): DataSourceMap {
  const projectRoot = resolve(/* turbopackIgnore: true */ options.projectRoot ?? process.cwd());
  const configPath = resolve(
    /* turbopackIgnore: true */
    projectRoot,
    options.configPath ?? "app/config/datasources.json"
  );

  let rawConfig: unknown;

  try {
    rawConfig = JSON.parse(readFileSync(/* turbopackIgnore: true */ configPath, "utf8"));
  } catch (error) {
    throw new DataSourceConfigError(
      `Unable to read datasource configuration at ${configPath}`,
      { cause: error }
    );
  }

  return parseDataSources(rawConfig, { ...options, projectRoot });
}
