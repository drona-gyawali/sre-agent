import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSourceConfig } from "@/app/lib/datasource.config";
import {
  normalizeSentryData,
  parseProjectSlugs,
  SentryAdapter,
} from "@/app/lib/datasource/adapters/sentry/sentry.adapter";
import type { McpToolResult, ToolExecutor } from "@/app/lib/mcp/mcp.interface";
import type { RegistryModelId } from "@/app/lib/model.registry";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({ generateText }));
vi.mock("@/app/lib/model.registry", () => ({
  getModel: vi.fn(() => "test-model"),
}));

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

const model = "google:gemini-2.5-flash" as RegistryModelId;
const adapter = new SentryAdapter();

function toolResult(
  toolName: string,
  value: unknown,
  structuredContent?: Record<string, unknown>
): McpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return {
    toolName,
    text,
    content: [{ type: "text", text }],
    structuredContent,
  };
}

const issueData = {
  query: "C-1001 card_declined",
  issues: [
    {
      shortId: "PAY-1",
      title: "CardDeclinedError: payment failed for customer C-1001",
      status: "unresolved",
      projectSlug: "payments",
    },
  ],
};

beforeEach(() => {
  generateText.mockReset();
});

describe("parseProjectSlugs", () => {
  it("extracts unique project slugs from discovery responses", () => {
    expect(
      parseProjectSlugs(
        toolResult("sentry_find_projects", {
          projects: [
            { slug: "payments" },
            { slug: "payments" },
            { slug: "checkout" },
          ],
          hasMore: false,
        })
      )
    ).toEqual(["payments", "checkout"]);
  });

  it("returns no projects for an empty discovery response", () => {
    expect(parseProjectSlugs(toolResult("sentry_find_projects", ""))).toEqual(
      []
    );
  });
});

describe("normalizeSentryData", () => {
  it("prefers structured content over text", () => {
    const result = toolResult("sentry_search_issues", "plain text", issueData);

    expect(normalizeSentryData(result)).toEqual(issueData);
  });

  it("parses JSON text when structured content is unavailable", () => {
    expect(
      normalizeSentryData(toolResult("sentry_search_issues", issueData))
    ).toEqual(issueData);
  });
});

describe("SentryAdapter.discover", () => {
  it("returns source metadata and discovered projects", async () => {
    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      expect(toolName).toBe("sentry_find_projects");
      expect(args).toEqual({ organizationSlug: "acme" });
      return toolResult(toolName, { projects: [{ slug: "payments" }] });
    });

    const result = await adapter.discover(source, executeTool);

    expect(result).toEqual({
      sourceId: "sentry",
      sourceName: "sentry",
      integrationType: "sentry",
      category: "error_tracking",
      tables: [],
      projects: ["payments"],
    });
  });

  it("skips discovery when no discovery tool is configured", async () => {
    const executeTool = vi.fn<ToolExecutor>();

    const result = await adapter.discover(
      { ...source, tools: { query: "sentry_search_issues" } },
      executeTool
    );

    expect(result.projects).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("returns no projects when the discovery tool is unavailable", async () => {
    const executeTool = vi.fn<ToolExecutor>(async (toolName) => {
      throw new Error(`Unknown MCP tool "${toolName}"`);
    });

    const result = await adapter.discover(source, executeTool);

    expect(result.projects).toEqual([]);
  });
});

describe("SentryAdapter.query", () => {
  it("generates a Sentry query and executes a project-scoped issue search", async () => {
    generateText.mockResolvedValue({
      text: "```\nC-1001 card_declined\n```",
    });

    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      if (toolName === "sentry_find_projects") {
        return toolResult(toolName, {
          projects: [{ slug: "payments" }],
        });
      }

      expect(toolName).toBe("sentry_search_issues");
      expect(args).toEqual({
        organizationSlug: "acme",
        projectSlugOrId: "payments",
        query: "C-1001 card_declined",
      });
      return toolResult(toolName, issueData, issueData);
    });

    const result = await adapter.query(
      { source, params: { customerId: "C-1001" }, model },
      executeTool
    );

    expect(result).toEqual({
      data: issueData,
      query: "C-1001 card_declined",
    });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Sentry issue search expert"),
      })
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"customerId":"C-1001"'),
      })
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("payments"),
      })
    );

    const prompt = generateText.mock.calls[0]?.[0]?.prompt as string;

    expect(prompt).toContain("is:unresolved level:error");
    expect(prompt).toContain("Use Sentry search syntax, not SQL or PromQL");
    expect(prompt).toContain("Do not invent project slugs");
    expect(prompt).toContain("untrusted evidence");
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("searches the whole organization when no project is configured", async () => {
    generateText.mockResolvedValue({ text: "is:unresolved C-1001" });

    const executeTool = vi.fn<ToolExecutor>(async (toolName, args) => {
      expect(toolName).toBe("sentry_search_issues");
      expect(args).toEqual({
        organizationSlug: "acme",
        query: "is:unresolved C-1001",
      });
      return toolResult(toolName, issueData);
    });

    const result = await adapter.query(
      {
        source: {
          ...source,
          tools: { query: "sentry_search_issues" },
          env: { ...source.env, SENTRY_PROJECT: "" },
        },
        params: {},
        model,
      },
      executeTool
    );

    expect(result.query).toBe("is:unresolved C-1001");
    expect(result.data).toEqual(issueData);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty generated query", async () => {
    generateText.mockResolvedValue({ text: "   " });
    const executeTool = vi.fn<ToolExecutor>();

    await expect(
      adapter.query(
        {
          source: { ...source, tools: { query: "sentry_search_issues" } },
          params: {},
          model,
        },
        executeTool
      )
    ).rejects.toMatchObject({
      name: "McpError",
      code: "INVALID_RESPONSE",
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("requires Sentry organization configuration", async () => {
    const executeTool = vi.fn<ToolExecutor>();

    await expect(
      adapter.query(
        {
          source: { ...source, env: { SENTRY_AUTH_TOKEN: "token" } },
          params: {},
          model,
        },
        executeTool
      )
    ).rejects.toMatchObject({
      name: "McpError",
      code: "CONFIGURATION_ERROR",
      message: expect.stringContaining("SENTRY_ORG"),
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("requires a Sentry auth token", async () => {
    const executeTool = vi.fn<ToolExecutor>();

    await expect(
      adapter.query(
        {
          source: { ...source, env: { SENTRY_ORG: "acme" } },
          params: {},
          model,
        },
        executeTool
      )
    ).rejects.toMatchObject({
      name: "McpError",
      code: "CONFIGURATION_ERROR",
      message: expect.stringContaining("SENTRY_AUTH_TOKEN"),
    });
  });
});
