import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { McpError } from "./mcp.errors";
import type {
  McpServerConfig,
  McpSessionOptions,
  McpToolInfo,
  McpToolResult,
  ToolArguments,
  ToolExecutor,
} from "./mcp.interface";
import { normalizeToolResult } from "./mcp-response";

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

interface ConnectedServer {
  readonly config: McpServerConfig;
  readonly client: Client;
  readonly tools: readonly McpToolInfo[];
}

interface ToolEntry {
  readonly server: ConnectedServer;
  readonly originalName: string;
}

interface ResolvedSessionOptions {
  readonly connectTimeoutMs: number;
  readonly toolTimeoutMs: number;
}

async function connectServer(
  config: McpServerConfig,
  options: ResolvedSessionOptions
): Promise<ConnectedServer> {
  const client = new Client(
    { name: config.name, version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args: [...config.args],
      env: config.env ? { ...config.env } : undefined,
      cwd: config.cwd,
    });

    await client.connect(transport, { timeout: options.connectTimeoutMs });

    const { tools } = await client.listTools(undefined, {
      timeout: options.connectTimeoutMs,
    });

    return {
      config,
      client,
      tools: tools.map((tool) => ({
        name: config.prefix ? `${config.prefix}_${tool.name}` : tool.name,
        originalName: tool.name,
        serverName: config.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  } catch (error) {
    await client.close().catch(() => undefined);

    throw new McpError(
      `Unable to connect to MCP server "${config.name}"`,
      "CONNECTION_FAILED",
      { serverName: config.name },
      { cause: error }
    );
  }
}

async function closeServers(servers: readonly ConnectedServer[]): Promise<void> {
  await Promise.allSettled(servers.map(({ client }) => client.close()));
}

export class McpSession {
  private readonly options: ResolvedSessionOptions;
  private readonly registry: ReadonlyMap<string, ToolEntry>;
  private closed = false;

  private constructor(
    private readonly servers: readonly ConnectedServer[],
    registry: ReadonlyMap<string, ToolEntry>,
    options: ResolvedSessionOptions
  ) {
    this.registry = registry;
    this.options = options;
  }

  static async create(
    configs: readonly McpServerConfig[],
    options: McpSessionOptions = {}
  ): Promise<McpSession> {
    const resolvedOptions: ResolvedSessionOptions = {
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      toolTimeoutMs: options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    };

    const results = await Promise.allSettled(
      configs.map((config) => connectServer(config, resolvedOptions))
    );

    const servers = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    if (failure) {
      await closeServers(servers);
      throw failure.reason;
    }

    const registry = new Map<string, ToolEntry>();

    for (const server of servers) {
      for (const tool of server.tools) {
        const existing = registry.get(tool.name);

        if (existing) {
          await closeServers(servers);
          throw new McpError(
            `Duplicate MCP tool "${tool.name}" exposed by "${existing.server.config.name}" and "${server.config.name}"`,
            "DUPLICATE_TOOL",
            { toolName: tool.name }
          );
        }

        registry.set(tool.name, {
          server,
          originalName: tool.originalName,
        });
      }
    }

    return new McpSession(servers, registry, resolvedOptions);
  }

  get tools(): readonly McpToolInfo[] {
    return this.servers.flatMap(({ tools }) => tools);
  }

  readonly executeTool: ToolExecutor = async (
    toolName: string,
    toolArguments: ToolArguments = {}
  ): Promise<McpToolResult> => {
    if (this.closed) {
      throw new McpError(
        `Cannot execute MCP tool "${toolName}" because the session is closed`,
        "SESSION_CLOSED",
        { toolName }
      );
    }

    const entry = this.registry.get(toolName);

    if (!entry) {
      throw new McpError(
        `Unknown MCP tool "${toolName}"`,
        "TOOL_NOT_FOUND",
        { toolName }
      );
    }

    try {
      const result = (await entry.server.client.callTool(
        { name: entry.originalName, arguments: toolArguments },
        CallToolResultSchema,
        { timeout: this.options.toolTimeoutMs }
      )) as CallToolResult;

      return normalizeToolResult(toolName, result, {
        serverName: entry.server.config.name,
      });
    } catch (error) {
      if (error instanceof McpError) throw error;

      throw new McpError(
        `MCP tool "${toolName}" failed on server "${entry.server.config.name}"`,
        "TOOL_EXECUTION_FAILED",
        {
          serverName: entry.server.config.name,
          toolName,
        },
        { cause: error }
      );
    }
  };

  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;

    const results = await Promise.allSettled(
      this.servers.map(({ client }) => client.close())
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );

    if (failures.length > 0) {
      throw new McpError(
        "Failed to close one or more MCP clients",
        "CLEANUP_FAILED",
        {},
        { cause: new AggregateError(failures) }
      );
    }
  }
}
