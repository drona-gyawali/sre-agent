import { describe, expect, it } from "vitest";
import type {
  DataSourceConfig,
  DataSourceMap,
} from "@/app/lib/datasource.config";
import { buildMcpServerConfigs } from "@/app/lib/mcp/mcp-servers";

function source(
  id: string,
  overrides: Partial<DataSourceConfig> = {}
): DataSourceMap {
  return {
    [id]: {
      id,
      name: id,
      type: "sqlite",
      category: id === "logs" ? "logs" : "database",
      package: "mcp-sqlite",
      tools: {
        query: `${id}_query`,
        listTables: `${id}_list_tables`,
        describeTable: `${id}_get_table_schema`,
      },
      env: { SOURCE_TOKEN: "value" },
      connection: `/tmp/${id}.db`,
      settings: { timeRangeMinutes: 60, stepSeconds: 60 },
      enabled: true,
      ...overrides,
    },
  };
}

describe("buildMcpServerConfigs", () => {
  it("builds the GitHub and datasource server configs", () => {
    const configs = buildMcpServerConfigs(
      { ...source("db"), ...source("logs") },
      { githubToken: "token" }
    );

    expect(configs).toHaveLength(3);
    expect(configs[0]).toMatchObject({
      name: "github-client",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" },
    });
    expect(configs[1]).toMatchObject({
      name: "db-client",
      prefix: "db",
      args: ["-y", "mcp-sqlite", "/tmp/db.db"],
      env: { SOURCE_TOKEN: "value" },
    });
  });

  it("passes PostgreSQL connection strings as server arguments", () => {
    const configs = buildMcpServerConfigs(
      source("postgres", {
        type: "postgres",
        package: "@modelcontextprotocol/server-postgres",
        tools: { query: "query" },
        connection: "postgresql://user:secret@db:5432/app",
      }),
      { includeGithub: false }
    );

    expect(configs[0]).toMatchObject({
      name: "postgres-client",
      prefix: "postgres",
      args: [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://user:secret@db:5432/app",
      ],
    });
  });

  it("omits the connection argument for env-configured integrations", () => {
    const configs = buildMcpServerConfigs(
      source("metrics", {
        type: "prometheus",
        category: "metrics",
        package: "prometheus-mcp-server",
        tools: { query: "prom_query", rangeQuery: "prom_range" },
        connection: undefined,
        env: { PROMETHEUS_URL: "http://prometheus:9090" },
      }),
      { includeGithub: false }
    );

    expect(configs[0]).toMatchObject({
      name: "metrics-client",
      args: ["-y", "prometheus-mcp-server"],
      env: { PROMETHEUS_URL: "http://prometheus:9090" },
    });
  });

  it("passes Sentry authentication and host environment variables", () => {
    const configs = buildMcpServerConfigs(
      source("sentry", {
        type: "sentry",
        category: "error_tracking",
        package: "@sentry/mcp-server",
        tools: {
          query: "sentry_search_issues",
          discover: "sentry_find_projects",
        },
        connection: undefined,
        env: {
          SENTRY_AUTH_TOKEN: "sntryu_test",
          SENTRY_ORG: "acme",
          SENTRY_PROJECT: "payments",
          SENTRY_HOST: "https://sentry.example.com",
        },
      }),
      { includeGithub: false }
    );

    expect(configs[0]).toMatchObject({
      name: "sentry-client",
      prefix: "sentry",
      args: ["-y", "@sentry/mcp-server"],
      env: {
        SENTRY_AUTH_TOKEN: "sntryu_test",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "payments",
        SENTRY_HOST: "https://sentry.example.com",
      },
    });
  });

  it("skips disabled datasources", () => {
    const configs = buildMcpServerConfigs(source("db", { enabled: false }), {
      includeGithub: false,
    });

    expect(configs).toEqual([]);
  });

  it("fails fast when the GitHub token is missing", () => {
    expect(() =>
      buildMcpServerConfigs(source("db"), { githubToken: "" })
    ).toThrowError(
      expect.objectContaining({
        name: "McpError",
        code: "CONFIGURATION_ERROR",
      })
    );
  });
});
