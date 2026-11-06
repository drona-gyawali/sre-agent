import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import rawDataSources from "@/app/config/datasources.json";
import {
  parseDataSources,
  resolveEnvironmentTemplate,
} from "@/app/lib/datasource.config";
import { loadDataSources } from "@/app/lib/datasource.config.file";

const workspaces: string[] = [];

function rawSource(overrides: Record<string, unknown> = {}) {
  return {
    name: "db",
    type: "sqlite",
    category: "database",
    package: "mcp-sqlite",
    mcp_tool: "db_query",
    schema_tool: "db_list_tables",
    column_tool: "db_get_table_schema",
    env: {},
    connection: "data.db",
    enabled: true,
    ...overrides,
  };
}

function createWorkspace(
  config: unknown,
  options: { createDatabase?: boolean } = {}
): string {
  const root = mkdtempSync(join(tmpdir(), "sre-agent-config-"));
  workspaces.push(root);
  writeFileSync(join(root, "datasources.json"), JSON.stringify(config), "utf8");

  if (options.createDatabase ?? true) {
    writeFileSync(join(root, "data.db"), "", "utf8");
  }

  return root;
}

function load(
  workspace: string,
  options: {
    env?: Record<string, string | undefined>;
    validateConnections?: boolean;
  } = {}
) {
  return loadDataSources({
    projectRoot: workspace,
    configPath: "datasources.json",
    env: options.env ?? {},
    validateConnections: options.validateConnections,
  });
}

afterEach(() => {
  while (workspaces.length > 0) {
    rmSync(workspaces.pop()!, { recursive: true, force: true });
  }
});

describe("resolveEnvironmentTemplate", () => {
  it("resolves variables and defaults", () => {
    expect(
      resolveEnvironmentTemplate("${DB_PATH:-fallback.db}", {
        DB_PATH: "custom.db",
      })
    ).toBe("custom.db");

    expect(resolveEnvironmentTemplate("${DB_PATH:-fallback.db}", {})).toBe(
      "fallback.db"
    );
  });

  it("throws when a required variable is missing", () => {
    expect(() => resolveEnvironmentTemplate("${DB_PATH}", {})).toThrowError(
      /DB_PATH/
    );
  });
});

describe("loadDataSources", () => {
  it("parses the committed datasource configuration from environment values", () => {
    const sources = parseDataSources(rawDataSources, {
      env: {
        DATABASE_PATH: "custom/database.db",
        LOGS_PATH: "custom/logs.db",
        POSTGRES_URL: "postgresql://user:secret@db.example:5432/app",
        PROMETHEUS_URL: "http://prometheus.example:9090",
        ENABLE_POSTGRES: "true",
        ENABLE_PROMETHEUS: "true",
      },
      validateConnections: false,
    });

    expect(Object.keys(sources)).toEqual([
      "database",
      "logs",
      "postgres",
      "metrics",
    ]);
    expect(sources.database?.type).toBe("sqlite");
    expect(sources.database?.category).toBe("database");
    expect(sources.logs?.category).toBe("logs");
    expect(sources.database?.connection).toBe(
      join(process.cwd(), "custom/database.db")
    );
    expect(sources.logs?.connection).toBe(
      join(process.cwd(), "custom/logs.db")
    );
    expect(sources.logs?.tools.query).toBe("logs_query");
    expect(sources.postgres).toMatchObject({
      type: "postgres",
      category: "database",
      connection: "postgresql://user:secret@db.example:5432/app",
      enabled: true,
    });
    expect(sources.postgres?.tools.listTables).toBeUndefined();
    expect(sources.metrics).toMatchObject({
      type: "prometheus",
      category: "metrics",
      enabled: true,
      tools: {
        query: "prom_query",
        rangeQuery: "prom_range",
        discover: "prom_discover",
      },
    });
    expect(sources.metrics?.connection).toBeUndefined();
    expect(sources.metrics?.env.PROMETHEUS_URL).toBe(
      "http://prometheus.example:9090"
    );
  });

  it("requires datasource environment values instead of config defaults", () => {
    expect(() =>
      parseDataSources(rawDataSources, {
        env: {},
        validateConnections: false,
      })
    ).toThrowError(/DATABASE_PATH/);
  });

  it("enables optional datasources from environment flags", () => {
    const root = createWorkspace(
      {
        postgres: rawSource({
          type: "postgres",
          connection: "postgresql://user:secret@db:5432/app",
          schema_tool: undefined,
          column_tool: undefined,
          enabled: "${ENABLE_POSTGRES:-false}",
        }),
      },
      { createDatabase: false }
    );

    expect(load(root).postgres.enabled).toBe(false);
    expect(
      load(root, { env: { ENABLE_POSTGRES: "true" } }).postgres.enabled
    ).toBe(true);
    expect(
      load(root, { env: { ENABLE_POSTGRES: "off" } }).postgres.enabled
    ).toBe(false);
  });

  it("allows disabled datasources without connection environment values", () => {
    const root = createWorkspace(
      {
        database: rawSource({
          connection: "${MISSING_DATABASE_PATH}",
          enabled: "${ENABLE_DATABASE:-true}",
        }),
      },
      { createDatabase: false }
    );

    const sources = load(root, { env: { ENABLE_DATABASE: "false" } });

    expect(sources.database).toMatchObject({
      enabled: false,
      connection: undefined,
      env: {},
    });
  });

  it("rejects invalid enabled values", () => {
    const root = createWorkspace({
      database: rawSource({ enabled: "${FEATURE_ENABLED}" }),
    });

    expect(() =>
      load(root, { env: { FEATURE_ENABLED: "sometimes" } })
    ).toThrowError(/invalid enabled value/);
  });

  it("loads and normalizes a valid datasource", () => {
    const root = createWorkspace({
      database: rawSource({
        connection: "${DB_PATH:-data.db}",
        env: { DB_TOKEN: "${TOKEN}" },
      }),
    });

    const sources = load(root, { env: { TOKEN: "secret" } });

    expect(sources.database).toMatchObject({
      id: "database",
      name: "db",
      type: "sqlite",
      category: "database",
      package: "mcp-sqlite",
      enabled: true,
      connection: join(root, "data.db"),
      env: { DB_TOKEN: "secret" },
      tools: {
        query: "db_query",
        listTables: "db_list_tables",
        describeTable: "db_get_table_schema",
      },
      settings: {
        timeRangeMinutes: 60,
        stepSeconds: 60,
      },
    });
  });

  it("accepts a PostgreSQL connection string without a local file", () => {
    const root = createWorkspace(
      {
        database: rawSource({
          type: "postgres",
          package: "@modelcontextprotocol/server-postgres",
          mcp_tool: "query",
          schema_tool: undefined,
          column_tool: undefined,
          connection: "postgresql://user:secret@db:5432/app",
        }),
      },
      { createDatabase: false }
    );

    const sources = load(root);

    expect(sources.database).toMatchObject({
      type: "postgres",
      connection: "postgresql://user:secret@db:5432/app",
      tools: { query: "query" },
    });
    expect(sources.database?.tools.listTables).toBeUndefined();
    expect(sources.database?.tools.describeTable).toBeUndefined();
  });

  it("accepts Prometheus configuration without a connection or schema tools", () => {
    const root = createWorkspace(
      {
        metrics: rawSource({
          name: "metrics",
          type: "prometheus",
          category: "metrics",
          package: "prometheus-mcp-server",
          mcp_tool: "prom_query",
          schema_tool: undefined,
          column_tool: undefined,
          discover_tool: "prom_discover",
          range_tool: "prom_range",
          connection: undefined,
          env: { PROMETHEUS_URL: "${PROM_URL:-http://localhost:9090}" },
          settings: { time_range_minutes: 30, step_seconds: 15 },
        }),
      },
      { createDatabase: false }
    );

    const sources = load(root);

    expect(sources.metrics).toMatchObject({
      type: "prometheus",
      category: "metrics",
      connection: undefined,
      tools: {
        query: "prom_query",
        discover: "prom_discover",
        rangeQuery: "prom_range",
      },
      settings: {
        timeRangeMinutes: 30,
        stepSeconds: 15,
      },
      env: { PROMETHEUS_URL: "http://localhost:9090" },
    });
  });

  it("keeps disabled sources in the configuration", () => {
    const root = createWorkspace({
      database: rawSource({ enabled: false }),
    });

    expect(load(root).database.enabled).toBe(false);
  });

  it("rejects unknown integration types", () => {
    const root = createWorkspace({
      database: rawSource({ type: "oracle" }),
    });

    expect(() => load(root)).toThrowError(/Invalid datasource configuration/);
  });

  it("rejects unknown source categories", () => {
    const root = createWorkspace({
      database: rawSource({ category: "events" }),
    });

    expect(() => load(root)).toThrowError(/Invalid datasource configuration/);
  });

  it("requires an integration type and category", () => {
    const root = createWorkspace({
      database: rawSource({ type: undefined, category: undefined }),
    });

    expect(() => load(root)).toThrowError(/Invalid datasource configuration/);
  });

  it("requires a connection string for PostgreSQL", () => {
    const root = createWorkspace(
      {
        database: rawSource({
          type: "postgres",
          connection: undefined,
          schema_tool: undefined,
          column_tool: undefined,
        }),
      },
      { createDatabase: false }
    );

    expect(() => load(root)).toThrowError(
      /requires a PostgreSQL connection string/
    );
  });

  it("requires schema tools for SQLite", () => {
    const root = createWorkspace({
      database: rawSource({ schema_tool: undefined, column_tool: undefined }),
    });

    expect(() => load(root)).toThrowError(
      /requires schema_tool and column_tool/
    );
  });

  it("rejects invalid Prometheus time-range settings", () => {
    const root = createWorkspace(
      {
        metrics: rawSource({
          type: "prometheus",
          category: "metrics",
          connection: undefined,
          schema_tool: undefined,
          column_tool: undefined,
          settings: { time_range_minutes: 0 },
        }),
      },
      { createDatabase: false }
    );

    expect(() => load(root)).toThrowError(/Invalid datasource configuration/);
  });

  it("rejects unknown configuration fields", () => {
    const root = createWorkspace({
      database: rawSource({ unexpected: true }),
    });

    expect(() => load(root)).toThrowError(/Invalid datasource configuration/);
  });

  it("rejects duplicate datasource names", () => {
    const root = createWorkspace({
      database: rawSource(),
      logs: rawSource({ connection: "logs.db" }),
    });
    writeFileSync(join(root, "logs.db"), "", "utf8");

    expect(() => load(root)).toThrowError(/Duplicate datasource name/);
  });

  it("rejects unresolved environment variables", () => {
    const root = createWorkspace({
      database: rawSource({ env: { DB_TOKEN: "${MISSING_TOKEN}" } }),
    });

    expect(() => load(root)).toThrowError(/MISSING_TOKEN/);
  });

  it("rejects missing connection files", () => {
    const root = createWorkspace(
      { database: rawSource({ connection: "missing.db" }) },
      { createDatabase: false }
    );

    expect(() => load(root)).toThrowError(/does not exist/);
  });

  it("rejects a missing configuration file", () => {
    expect(() =>
      loadDataSources({
        projectRoot: tmpdir(),
        configPath: "does-not-exist.json",
      })
    ).toThrowError(/Unable to read datasource configuration/);
  });

  it("rejects a directory used as a connection", () => {
    const root = createWorkspace(
      { database: rawSource({ connection: "." }) },
      { createDatabase: false }
    );

    expect(() => load(root)).toThrowError(/must be a file/);
  });
});
