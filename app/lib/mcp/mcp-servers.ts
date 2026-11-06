import type { DataSourceMap } from "../datasource.config";
import { McpError } from "./mcp.errors";
import type { McpServerConfig } from "./mcp.interface";

const DEFAULT_MCP_COMMAND = "npx";
const GITHUB_MCP_PACKAGE = "@modelcontextprotocol/server-github";

export interface BuildMcpServerConfigsOptions {
  readonly githubToken?: string;
  readonly includeGithub?: boolean;
  readonly command?: string;
}

export function buildMcpServerConfigs(
  sources: DataSourceMap,
  options: BuildMcpServerConfigsOptions = {}
): McpServerConfig[] {
  const configs: McpServerConfig[] = [];
  const command = options.command ?? DEFAULT_MCP_COMMAND;

  if (options.includeGithub ?? true) {
    const githubToken =
      options.githubToken ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

    if (!githubToken) {
      throw new McpError(
        "GITHUB_PERSONAL_ACCESS_TOKEN is required to connect to the GitHub MCP server",
        "CONFIGURATION_ERROR",
        { serverName: "github-client" }
      );
    }

    configs.push({
      name: "github-client",
      command,
      args: ["-y", GITHUB_MCP_PACKAGE],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
    });
  }

  for (const source of Object.values(sources)) {
    if (!source.enabled) continue;

    const args = ["-y", source.package];

    if (source.connection) {
      args.push(source.connection);
    }

    configs.push({
      name: `${source.name}-client`,
      prefix: source.name,
      command,
      args,
      env: { ...source.env },
    });
  }

  return configs;
}
