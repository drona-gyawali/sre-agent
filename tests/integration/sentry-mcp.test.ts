import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import { createDefaultDataSourceRegistry } from "@/app/lib/datasource/datasource.registry";
import { DataSourceService } from "@/app/lib/datasource/datasource.service";
import { McpSession } from "@/app/lib/mcp/mcp-manager";
import type { McpServerConfig } from "@/app/lib/mcp/mcp.interface";
import type { RegistryModelId } from "@/app/lib/model.registry";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({ generateText }));
vi.mock("@/app/lib/model.registry", () => ({
  getModel: vi.fn(() => "test-model"),
}));

const model = "google:gemini-2.5-flash" as RegistryModelId;
const serverEntry = fileURLToPath(
  new URL("./fixtures/mock-sentry-mcp-server.mjs", import.meta.url)
);

const source: DataSourceConfig = {
  id: "sentry",
  name: "sentry",
  type: "sentry",
  category: "error_tracking",
  package: "@sentry/mcp-server",
  tools: {
    query: "sentry_search_issues",
    discover: "sentry_find_projects",
  },
  env: {
    SENTRY_AUTH_TOKEN: "sntryu_test",
    SENTRY_ORG: "acme",
    SENTRY_PROJECT: "payments",
    SENTRY_HOST: "https://sentry.example.com",
  },
  settings: { timeRangeMinutes: 60, stepSeconds: 60 },
  enabled: true,
};

const serverConfig: McpServerConfig = {
  name: "sentry-test-client",
  prefix: "sentry",
  command: process.execPath,
  args: [serverEntry],
  env: {},
};

let session: McpSession | undefined;
let service: DataSourceService | undefined;

beforeAll(async () => {
  session = await McpSession.create([serverConfig]);
  service = new DataSourceService({
    registry: createDefaultDataSourceRegistry(),
    executeTool: session.executeTool,
    model,
  });
});

afterAll(async () => {
  await session?.close();
});

beforeEach(() => {
  generateText.mockReset();
});

function requireSession(): McpSession {
  if (!session) throw new Error("Sentry MCP session is not initialized");
  return session;
}

function requireService(): DataSourceService {
  if (!service) throw new Error("Sentry datasource service is not initialized");
  return service;
}

describe("Sentry MCP integration", () => {
  it("discovers the mock server tools with datasource prefixes", () => {
    const toolNames = requireSession().tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining(["sentry_find_projects", "sentry_search_issues"])
    );
  });

  it("discovers Sentry projects through the registry and adapter", async () => {
    const discovery = await requireService().discover(source);

    expect(discovery).toMatchObject({
      sourceId: "sentry",
      sourceName: "sentry",
      integrationType: "sentry",
      category: "error_tracking",
      tables: [],
      projects: ["payments", "checkout"],
    });
  });

  it("generates and executes an issue search through the MCP session", async () => {
    generateText.mockResolvedValue({
      text: "C-1001 card_declined",
    });

    const result = await requireService().query(source, {
      customerId: "C-1001",
      errorCode: "card_declined",
    });

    expect(result).toMatchObject({
      sourceId: "sentry",
      integrationType: "sentry",
      category: "error_tracking",
      status: "success",
      query: "C-1001 card_declined",
      data: {
        query: "C-1001 card_declined",
        executedSearch: {
          query: "C-1001 card_declined",
          projectSlugOrId: "payments",
        },
        issues: [
          {
            shortId: "PAY-1",
            title: expect.stringContaining("C-1001"),
            projectSlug: "payments",
          },
        ],
      },
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("isolates Sentry tool failures as failed source results", async () => {
    generateText.mockResolvedValue({ text: "C-1001" });

    const result = await requireService().investigateSource(
      {
        ...source,
        tools: { query: "sentry_missing_tool" },
      },
      { customerId: "C-1001" }
    );

    expect(result).toMatchObject({
      sourceId: "sentry",
      integrationType: "sentry",
      status: "failed",
      data: null,
    });
    expect(result.error).toContain("sentry_missing_tool");
  });
});
