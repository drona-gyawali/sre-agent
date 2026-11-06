import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { McpError } from "@/app/lib/mcp/mcp.errors";
import type { McpToolResult } from "@/app/lib/mcp/mcp.interface";
import {
  extractText,
  normalizeToolResult,
  parseJsonResult,
  parseJsonText,
} from "@/app/lib/mcp/mcp-response";

type Content = CallToolResult["content"];

function text(value: string): Content[number] {
  return { type: "text", text: value };
}

function toolResult(
  value: string,
  toolName = "test_tool"
): McpToolResult {
  return normalizeToolResult(toolName, { content: [text(value)] });
}

describe("extractText", () => {
  it("joins text and resource content while ignoring binary content", () => {
    const content: Content = [
      text("first"),
      {
        type: "image",
        data: "base64",
        mimeType: "image/png",
      },
      {
        type: "resource",
        resource: {
          uri: "file:///evidence.txt",
          text: "resource text",
        },
      },
    ];

    expect(extractText(content)).toBe("first\nresource text");
  });
});

describe("normalizeToolResult", () => {
  it("returns normalized text and structured content", () => {
    const result = normalizeToolResult("db_query", {
      content: [text('{"ok":true}')],
      structuredContent: { ok: true },
    });

    expect(result).toMatchObject({
      toolName: "db_query",
      text: '{"ok":true}',
      structuredContent: { ok: true },
    });
  });

  it("throws a structured error when the MCP tool reports isError", () => {
    expect(() =>
      normalizeToolResult(
        "db_query",
        {
          content: [text("near SELECT: syntax error")],
          isError: true,
        },
        { serverName: "db-client" }
      )
    ).toThrowError(
      expect.objectContaining({
        name: "McpError",
        code: "TOOL_EXECUTION_FAILED",
        context: { serverName: "db-client", toolName: "db_query" },
        message: "near SELECT: syntax error",
      })
    );
  });
});

describe("parseJsonText", () => {
  it("parses plain JSON", () => {
    expect(parseJsonText('{"tables":[]}')).toEqual({ tables: [] });
  });

  it("parses fenced JSON", () => {
    expect(parseJsonText('```json\n[{"name":"records"}]\n```')).toEqual([
      { name: "records" },
    ]);
  });

  it("throws for malformed JSON", () => {
    expect(() => parseJsonText("{not json")).toThrowError(SyntaxError);
  });
});

describe("parseJsonResult", () => {
  it("parses the text payload", () => {
    expect(parseJsonResult(toolResult('{"count":2}'))).toEqual({ count: 2 });
  });

  it("falls back to structured content when text is empty", () => {
    const result = normalizeToolResult("db_info", {
      content: [],
      structuredContent: { exists: true },
    });

    expect(parseJsonResult(result)).toEqual({ exists: true });
  });

  it("raises an MCP error for malformed JSON", () => {
    expect(() => parseJsonResult(toolResult("not-json"))).toThrowError(
      expect.objectContaining({
        name: "McpError",
        code: "INVALID_RESPONSE",
      })
    );
  });

  it("raises an MCP error when no payload is present", () => {
    const result = normalizeToolResult("db_info", { content: [] });

    expect(() => parseJsonResult(result)).toThrowError(McpError);
  });
});
