export type McpErrorCode =
  | "CONFIGURATION_ERROR"
  | "CONNECTION_FAILED"
  | "TOOL_NOT_FOUND"
  | "DUPLICATE_TOOL"
  | "TOOL_EXECUTION_FAILED"
  | "INVALID_RESPONSE"
  | "SESSION_CLOSED"
  | "CLEANUP_FAILED";

export interface McpErrorContext {
  readonly serverName?: string;
  readonly toolName?: string;
}

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly context: McpErrorContext;

  constructor(
    message: string,
    code: McpErrorCode,
    context: McpErrorContext = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "McpError";
    this.code = code;
    this.context = context;
  }
}

export class DataSourceConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DataSourceConfigError";
  }
}
