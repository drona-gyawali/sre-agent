import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpError, type McpErrorContext } from "./mcp.errors";
import type { McpToolResult } from "./mcp.interface";

type ToolCallResponse = Pick<
  CallToolResult,
  "content" | "isError" | "structuredContent"
>;

function isTextContent(
  item: CallToolResult["content"][number]
): item is Extract<CallToolResult["content"][number], { type: "text" }> {
  return item.type === "text";
}

function isTextResource(
  item: CallToolResult["content"][number]
): item is Extract<CallToolResult["content"][number], { type: "resource" }> & {
  resource: { text: string };
} {
  return item.type === "resource" && "text" in item.resource;
}

export function extractText(content: CallToolResult["content"]): string {
  return content
    .flatMap((item) => {
      if (isTextContent(item)) return [item.text];
      if (isTextResource(item)) return [item.resource.text];
      return [];
    })
    .join("\n");
}

export function normalizeToolResult(
  toolName: string,
  result: ToolCallResponse,
  context: Omit<McpErrorContext, "toolName"> = {}
): McpToolResult {
  const text = extractText(result.content);

  if (result.isError) {
    throw new McpError(
      text || `MCP tool "${toolName}" reported an error without details`,
      "TOOL_EXECUTION_FAILED",
      { ...context, toolName }
    );
  }

  return {
    toolName,
    text,
    content: result.content,
    structuredContent: result.structuredContent,
  };
}

export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const payload = (fenced?.[1] ?? trimmed).trim();

  if (!payload) {
    throw new SyntaxError("Cannot parse JSON from an empty response");
  }

  return JSON.parse(payload);
}

export function parseJsonResult<T>(result: McpToolResult): T {
  try {
    if (result.text.trim()) {
      return parseJsonText(result.text) as T;
    }

    if (result.structuredContent) {
      return result.structuredContent as unknown as T;
    }
  } catch (error) {
    throw new McpError(
      `MCP tool "${result.toolName}" returned malformed JSON`,
      "INVALID_RESPONSE",
      { toolName: result.toolName },
      { cause: error }
    );
  }

  throw new McpError(
    `MCP tool "${result.toolName}" returned no data`,
    "INVALID_RESPONSE",
    { toolName: result.toolName }
  );
}
