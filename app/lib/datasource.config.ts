import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import {
  INTEGRATION_TYPES,
  SOURCE_CATEGORIES,
  type IntegrationType,
  type SourceCategory,
} from "./datasource/datasource.types";
import { DataSourceConfigError } from "./mcp/mcp.errors";

const identifierSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    "must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens"
  );

const rawSettingsSchema = z
  .object({
    time_range_minutes: z.number().int().positive().optional(),
    step_seconds: z.number().int().positive().optional(),
  })
  .strict()
  .default({});

const rawDataSourceSchema = z
  .object({
    name: identifierSchema,
    type: z.enum(INTEGRATION_TYPES),
    category: z.enum(SOURCE_CATEGORIES),
    package: z.string().trim().min(1),
    mcp_tool: z.string().trim().min(1),
    schema_tool: z.string().trim().min(1).optional(),
    column_tool: z.string().trim().min(1).optional(),
    discover_tool: z.string().trim().min(1).optional(),
    range_tool: z.string().trim().min(1).optional(),
    env: z.record(z.string(), z.string()).default({}),
    connection: z.string().trim().min(1).optional(),
    settings: rawSettingsSchema,
    enabled: z
      .union([z.boolean(), z.string().trim().min(1)])
      .default(true),
  })
  .strict();

const dataSourcesFileSchema = z.record(identifierSchema, rawDataSourceSchema);

export interface DataSourceTools {
  readonly query: string;
  readonly listTables?: string;
  readonly describeTable?: string;
  readonly discover?: string;
  readonly rangeQuery?: string;
}

export interface DataSourceSettings {
  readonly timeRangeMinutes: number;
  readonly stepSeconds: number;
}

export interface DataSourceConfig {
  readonly id: string;
  readonly name: string;
  readonly type: IntegrationType;
  readonly category: SourceCategory;
  readonly package: string;
  readonly tools: DataSourceTools;
  readonly settings: DataSourceSettings;
  readonly env: Readonly<Record<string, string>>;
  readonly connection?: string;
  readonly enabled: boolean;
}

export type DataSourceMap = Readonly<Record<string, DataSourceConfig>>;

export interface ParseDataSourcesOptions {
  readonly projectRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly validateConnections?: boolean;
}

const ENV_TEMPLATE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function resolveEnvironmentTemplate(
  value: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  return value.replace(ENV_TEMPLATE, (_, key: string, fallback?: string) => {
    const resolved = env[key];

    if (resolved !== undefined) return resolved;
    if (fallback !== undefined) return fallback;

    throw new DataSourceConfigError(
      `Environment variable "${key}" is required but is not defined`
    );
  });
}

function resolveConnectionValue(
  type: IntegrationType,
  connection: string,
  projectRoot: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  const expanded = resolveEnvironmentTemplate(connection, env);

  if (type !== "sqlite") {
    return expanded;
  }

  return isAbsolute(expanded) ? expanded : resolve(projectRoot, expanded);
}

function validateConnectionFile(
  sourceId: string,
  connectionPath: string
): void {
  let stats;

  try {
    stats = statSync(/* turbopackIgnore: true */ connectionPath);
  } catch (error) {
    throw new DataSourceConfigError(
      `Datasource "${sourceId}" points to a connection that does not exist: ${connectionPath}`,
      { cause: error }
    );
  }

  if (!stats.isFile()) {
    throw new DataSourceConfigError(
      `Datasource "${sourceId}" connection must be a file: ${connectionPath}`
    );
  }
}

function resolveEnabled(
  sourceId: string,
  value: boolean | string,
  env: Readonly<Record<string, string | undefined>>
): boolean {
  if (typeof value === "boolean") return value;

  const resolved = resolveEnvironmentTemplate(value, env).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(resolved)) return true;
  if (["false", "0", "no", "off"].includes(resolved)) return false;

  throw new DataSourceConfigError(
    `Datasource "${sourceId}" has an invalid enabled value: "${resolved}"`
  );
}

function validateSourceRequirements(
  sourceId: string,
  source: z.infer<typeof rawDataSourceSchema>,
  connection: string | undefined,
  validateConnections: boolean
): void {
  if (source.type === "sqlite") {
    if (!connection) {
      throw new DataSourceConfigError(
        `Datasource "${sourceId}" requires a connection path`
      );
    }

    if (!source.schema_tool || !source.column_tool) {
      throw new DataSourceConfigError(
        `Datasource "${sourceId}" requires schema_tool and column_tool`
      );
    }

    if (validateConnections) {
      validateConnectionFile(sourceId, connection);
    }
  }

  if (source.type === "postgres" && !connection) {
    throw new DataSourceConfigError(
      `Datasource "${sourceId}" requires a PostgreSQL connection string`
    );
  }
}

export function parseDataSources(
  rawConfig: unknown,
  options: ParseDataSourcesOptions = {}
): DataSourceMap {
  const projectRoot = resolve(
    /* turbopackIgnore: true */ options.projectRoot ?? process.cwd()
  );
  const env = options.env ?? process.env;
  const parsed = dataSourcesFileSchema.safeParse(rawConfig);

  if (!parsed.success) {
    throw new DataSourceConfigError(
      `Invalid datasource configuration:\n${z.prettifyError(parsed.error)}`
    );
  }

  const names = new Set<string>();
  const sources: Record<string, DataSourceConfig> = {};

  for (const [id, source] of Object.entries(parsed.data)) {
    if (names.has(source.name)) {
      throw new DataSourceConfigError(
        `Duplicate datasource name "${source.name}"; datasource names must be unique`
      );
    }
    names.add(source.name);

    const enabled = resolveEnabled(id, source.enabled, env);
    const connection =
      enabled && source.connection
        ? resolveConnectionValue(source.type, source.connection, projectRoot, env)
        : undefined;

    if (enabled) {
      validateSourceRequirements(
        id,
        source,
        connection,
        options.validateConnections !== false
      );
    }

    const resolvedEnv = enabled
      ? Object.fromEntries(
          Object.entries(source.env).map(([key, value]) => [
            key,
            resolveEnvironmentTemplate(value, env),
          ])
        )
      : {};

    sources[id] = {
      id,
      name: source.name,
      type: source.type,
      category: source.category,
      package: source.package,
      tools: {
        query: source.mcp_tool,
        listTables: source.schema_tool,
        describeTable: source.column_tool,
        discover: source.discover_tool,
        rangeQuery: source.range_tool,
      },
      settings: {
        timeRangeMinutes: source.settings.time_range_minutes ?? 60,
        stepSeconds: source.settings.step_seconds ?? 60,
      },
      env: resolvedEnv,
      connection,
      enabled,
    };
  }

  return sources;
}
