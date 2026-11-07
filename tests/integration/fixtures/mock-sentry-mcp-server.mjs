import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const projects = [
  { id: "1", slug: "payments", name: "Payments" },
  { id: "2", slug: "checkout", name: "Checkout" },
];

const issues = [
  {
    shortId: "PAY-1",
    title: "CardDeclinedError: payment failed for customer C-1001",
    url: "https://sentry.example.com/organizations/acme/issues/PAY-1",
    status: "unresolved",
    occurrences: 42,
    usersImpacted: 2,
    firstSeen: "2026-01-01T00:00:00Z",
    lastSeen: "2026-01-01T01:00:00Z",
    culprit: "checkout.submit",
    projectSlug: "payments",
  },
];

function textResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

const server = new McpServer({
  name: "mock-sentry",
  version: "1.0.0",
});

server.registerTool(
  "find_projects",
  {
    description: "List projects in a Sentry organization",
    inputSchema: { organizationSlug: z.string() },
  },
  async ({ organizationSlug }) =>
    textResult({ projects, organizationSlug, hasMore: false, nextCursor: null })
);

server.registerTool(
  "search_issues",
  {
    description: "Search grouped Sentry issues",
    inputSchema: {
      organizationSlug: z.string(),
      query: z.string(),
      projectSlugOrId: z.string().optional(),
      limit: z.number().optional(),
      period: z.string().optional(),
    },
  },
  async ({ organizationSlug, query, projectSlugOrId }) => {
    const scoped = projectSlugOrId
      ? issues.filter((issue) => issue.projectSlug === projectSlugOrId)
      : issues;

    return textResult({
      query,
      organizationSlug,
      executedSearch: {
        query,
        projectSlugOrId: projectSlugOrId ?? null,
      },
      issues: scoped,
    });
  }
);

await server.connect(new StdioServerTransport());
