import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export interface McpServerConfig {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly prefix?: string;
}

export interface McpToolInfo {
  readonly name: string;
  readonly originalName: string;
  readonly serverName: string;
  readonly description?: string;
  readonly inputSchema: Tool["inputSchema"];
}

export interface McpToolResult {
  readonly toolName: string;
  readonly text: string;
  readonly content: CallToolResult["content"];
  readonly structuredContent?: Record<string, unknown>;
}

export type ToolArguments = Record<string, unknown>;

export type ToolExecutor = (
  toolName: string,
  args?: ToolArguments
) => Promise<McpToolResult>;

export interface McpSessionOptions {
  readonly connectTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
}
