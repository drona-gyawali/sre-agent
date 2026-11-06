# Phase 1: MCP Execution Foundation

This document records the Phase 1 audit of the existing MCP client and the execution foundation that replaces it.

## Existing implementation (before Phase 1)

`app/lib/mcp-client.ts` created every MCP client on each call:

- Each graph node called `createMcpClients()`, which spawned a GitHub server and one `mcp-sqlite` server per configured datasource.
- The returned object exposed untyped `executeTool`, `tools`, `clients`, `toolRegistry`, and `close` members.
- Tool results were treated as `{ content: { text: string }[] }` throughout the graph and datasource code.
- `isError`, non-text content, missing content, and malformed JSON were not handled.
- Datasource configuration was imported directly from JSON without validation.
- SQLite table discovery treated the JSON response as free text:
  `tables.match(/\w+/g)` also matched the JSON key `"name"`, so schema discovery requested a table named `name`.
- The datasource config contained machine-specific absolute database paths.

## Phase 1 contracts

### MCP transport types

Defined in `app/lib/mcp/mcp.interface.ts`:

- `McpServerConfig`: server name, command, args, environment, working directory, optional tool prefix.
- `McpToolInfo`: exposed tool name, original tool name, owning server, description, input schema.
- `McpToolResult`: normalized text, raw MCP content, optional structured content.
- `ToolExecutor`: the single execution contract used by graph nodes and datasource code.

### Structured errors

Defined in `app/lib/mcp/mcp.errors.ts`:

| Code | Meaning |
|---|---|
| `CONFIGURATION_ERROR` | Required MCP configuration is missing. |
| `CONNECTION_FAILED` | A server could not be started or initialized. |
| `TOOL_NOT_FOUND` | The requested tool is not registered in the session. |
| `DUPLICATE_TOOL` | Two servers expose the same resolved tool name. |
| `TOOL_EXECUTION_FAILED` | A tool threw, timed out, or returned `isError`. |
| `INVALID_RESPONSE` | A tool response could not be parsed. |
| `SESSION_CLOSED` | A tool was invoked after session cleanup. |
| `CLEANUP_FAILED` | One or more clients failed to close. |

### Response normalization

Defined in `app/lib/mcp/mcp-response.ts`:

- Text and text-resource content are concatenated; binary content is ignored.
- `isError` responses become `McpError` instances with the server and tool name attached.
- JSON payloads are parsed from text, with structured content used as a fallback.
- Invalid or empty payloads become `INVALID_RESPONSE` errors instead of silent fallbacks.

## Centralized lifecycle

`app/lib/mcp/mcp-manager.ts` provides `McpSession`:

- `McpSession.create(configs)` connects all configured servers concurrently.
- Partial connection failures roll back already-connected clients.
- Tool names are resolved once, including optional datasource prefixes.
- Concurrent duplicate tool names fail during startup.
- `executeTool` applies a per-call timeout and wraps all failures.
- `close()` is idempotent and attempts to close every client even if one close fails.

`runDiagnosticAgent` now creates one session per investigation and closes it in a `finally` block after the LangGraph stream completes. Graph nodes receive `session.executeTool`; they no longer create clients.

Server configuration is built in `app/lib/mcp/mcp-servers.ts`, which also fails fast when the GitHub token is missing and skips disabled datasources.

## Datasource configuration validation

`app/lib/datasource.config.ts` validates the datasource configuration with Zod. The agent loads the committed JSON as a static import for production builds; `app/lib/datasource.config.file.ts` provides the file-based loader used by tests.

- Datasource IDs and names must be lowercase identifiers.
- Tool mappings are required.
- Only supported query languages are accepted (`sqlite` in Phase 1).
- Unknown fields are rejected.
- Datasource names must be unique.
- `${VAR}` and `${VAR:-fallback}` templates are resolved from the environment.
- Relative connection paths resolve from the project root.
- Connection files must exist and be regular files.

The default configuration now uses relative paths with environment overrides:

```json
"connection": "${DATABASE_PATH}"
```

## SQLite discovery and execution

`app/lib/datasource.ts` now:

1. Calls the configured `listTables` tool.
2. Parses the JSON response into table names, supporting `[{ "name": "..." }]`, string arrays, and the `mcp-sqlite` empty-database object.
3. Calls `describeTable` once per discovered table.
4. Parses PRAGMA-style column metadata into typed columns.
5. Renders exact table and column names into the SQL-generation prompt.
6. Executes the generated query through the same typed executor.
7. Returns normalized text or `"No results"`.

This removes the previous false table named `name` and prevents malformed MCP responses from reaching the report prompt.

## Tests

Vitest is configured through `vitest.config.ts`.

- `tests/unit/mcp-response.test.ts` covers content extraction, `isError` handling, and JSON parsing.
- `tests/unit/datasource.config.test.ts` covers config validation, environment resolution, duplicate names, and connection checks.
- `tests/unit/sqlite-schema.test.ts` covers table and column parsing, discovery orchestration, schema formatting, and SQL cleanup.
- `tests/integration/sqlite-mcp.test.ts` starts a real `mcp-sqlite` process against a temporary SQLite database and covers connection, tool discovery, schema discovery, query execution, concurrency, error wrapping, and cleanup.

Run the suite with:

```bash
npm test
npm run typecheck
npm run lint
```
