# Phase 5: Sentry Integration

This document records the Sentry error-tracking integration added to the extensible SRE diagnostic agent architecture.

Building on the Phase 2 adapter contract and Phase 4 integrations, Sentry was added as another config-driven datasource. The LangGraph workflow did not change: `fetch_issue -> extract_identifiers -> investigate_sources -> generate_report` remains the complete graph.

## Goals

- Support Sentry as an `error_tracking` integration type.
- Discover project slugs from the configured Sentry organization.
- Generate a Sentry issue search query from extracted incident identifiers.
- Execute the search through the real `@sentry/mcp-server` stdio MCP server.
- Keep Sentry failures isolated from database, logs, and metric sources.
- Provide unit, mocked MCP integration, and real Docker-backed integration coverage.
- Avoid requiring a live Sentry account in automated tests.

## Architecture

### 1. Sentry adapter (`app/lib/datasource/adapters/sentry/sentry.adapter.ts`)

`SentryAdapter` implements the standard `DataSourceAdapter` contract:

- `type = "sentry"`.
- `discover(source, executor)` calls the configured discovery tool, normally `find_projects`, and normalizes project slugs into `DiscoveryResult.projects`.
- `query(input, executor)`:
  1. Requires `SENTRY_ORG` and `SENTRY_AUTH_TOKEN`.
  2. Runs project discovery to include known project slugs in the prompt.
  3. Asks the configured model for a single Sentry issue search query.
  4. Cleans markdown fences with the shared `cleanGeneratedQuery` helper.
  5. Calls `search_issues` with `organizationSlug`, the generated `query`, and optional `projectSlugOrId`.
  6. Prefers `structuredContent` from the MCP response, falling back to parsed JSON text.

The adapter throws `McpError` with code `INVALID_RESPONSE` for an empty model query and `CONFIGURATION_ERROR` for missing Sentry settings.

### 2. Shared discovery type

`DiscoveryResult` gained an optional `projects` field:

```typescript
interface DiscoveryResult {
  // ...
  readonly tables: readonly DiscoveryTable[];
  readonly metrics?: readonly string[];
  readonly projects?: readonly string[];
}
```

Existing adapters and tests are unaffected because the field is optional.

### 3. Registry (`app/lib/datasource/datasource.registry.ts`)

`createDefaultDataSourceRegistry()` now registers:

```text
sqlite     -> SqlAdapter(SQLITE_DIALECT)
postgres   -> SqlAdapter(POSTGRES_DIALECT)
prometheus -> PrometheusAdapter
sentry     -> SentryAdapter
```

### 4. Configuration (`app/config/datasources.json`)

The committed Sentry source is disabled by default:

```json
{
  "sentry": {
    "name": "sentry",
    "type": "sentry",
    "category": "error_tracking",
    "package": "@sentry/mcp-server",
    "mcp_tool": "sentry_search_issues",
    "discover_tool": "sentry_find_projects",
    "env": {
      "SENTRY_AUTH_TOKEN": "${SENTRY_AUTH_TOKEN}",
      "SENTRY_ORG": "${SENTRY_ORG}",
      "SENTRY_PROJECT": "${SENTRY_PROJECT:-}",
      "SENTRY_HOST": "${SENTRY_HOST:-https://sentry.io}"
    },
    "enabled": "${ENABLE_SENTRY:-false}"
  }
}
```

When `ENABLE_SENTRY=true`, configuration loading requires non-empty `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`. `SENTRY_PROJECT` is optional.

### 5. MCP server configuration

No special case was needed in `app/lib/mcp/mcp-servers.ts`. The generic datasource loop starts every enabled source with:

```text
npx -y @sentry/mcp-server
```

and passes `source.env` through to the process. The source name `sentry` prefixes every exposed tool, so the MCP session registers `sentry_find_projects` and `sentry_search_issues`. The Sentry MCP package requires Node.js 22.15 or later.

### 6. Health checks (`app/lib/datasource-health.ts`)

The Sentry health check makes a direct HTTP request instead of starting an MCP server:

```text
GET {SENTRY_HOST}/api/0/organizations/{SENTRY_ORG}/
Authorization: Bearer {SENTRY_AUTH_TOKEN}
```

A non-2xx response marks the source as `"down"`. Missing token or organization configuration is reported as a down reason. This follows the Prometheus pattern, where health is checked over HTTP and MCP is started only for an investigation.

### 7. Graph behavior

No graph nodes or edges changed. The planner sees Sentry as an enabled source with category `error_tracking` and includes it when relevant. `DataSourceService` runs it concurrently with the other selected sources, and `formatSourceResultsForPrompt` includes its query, evidence, or failure in the report prompt.

## Usage

Add these values to `.env`:

```bash
SENTRY_AUTH_TOKEN=sntryu_...
SENTRY_ORG=my-org
SENTRY_PROJECT=checkout
SENTRY_HOST=https://sentry.io
ENABLE_SENTRY=true
```

Then restart the application:

```bash
npm run dev
```

During a diagnosis, the Sentry source:

1. Discovers projects in `my-org`.
2. Generates a query such as `C-1001 card_declined is:unresolved`.
3. Executes the search against the configured project, or the whole organization when `SENTRY_PROJECT` is empty.
4. Returns issue IDs, titles, status, occurrence counts, affected users, and Sentry URLs as evidence.

`GET /api/health` reports Sentry as `up`, `down`, or `disabled` alongside the other sources.

## Tests

### Unit tests

- `tests/unit/sentry-adapter.test.ts`: project parsing, structured-content normalization, project discovery, query generation, project scoping, empty-query rejection, and missing configuration.
- `tests/unit/datasource-registry.test.ts`: default registry includes `SentryAdapter`.
- `tests/unit/datasource.config.test.ts`: committed Sentry config, environment resolution, optional project handling, and required credentials.
- `tests/unit/mcp-servers.test.ts`: Sentry MCP process arguments and environment variables.
- `tests/unit/datasource-service-integrations.test.ts`: end-to-end service investigation for Sentry with mocked tools.
- `tests/unit/datasource-health.test.ts`: Sentry health URL, bearer token, HTTP failures, and missing configuration.
- `tests/unit/diagnostic-graph.test.ts`: graph topology remains unchanged with Sentry configured.

### Mocked MCP integration test

`tests/integration/sentry-mcp.test.ts` starts `tests/integration/fixtures/mock-sentry-mcp-server.mjs` as a real stdio MCP server. It verifies:

- Tool prefixing: `sentry_find_projects` and `sentry_search_issues`.
- Project discovery through the registry and adapter.
- Query generation and execution through a real `McpSession`.
- Failure isolation when a tool is missing.

This suite runs with the default `npm test` command and needs no network or Docker.

### Real Docker-backed integration test

`tests/integration/fixtures/docker-compose.yml` now starts a `sentry-mock` container. The container serves a small Sentry-compatible API:

- `GET /api/0/organizations/acme/`
- `GET /api/0/organizations/acme/projects/`
- `GET /api/0/projects/acme/payments/`
- `GET /api/0/organizations/acme/issues/`
- `GET /api/0/auth/`

The real suite then starts the actual `@sentry/mcp-server` process against the mock API and verifies:

- Sentry MCP tools are discovered with prefixes.
- Project discovery returns `payments`.
- Health checks report Sentry as `up`.
- Gemini generates a Sentry query and the MCP server returns the seeded `PAY-1` issue.
- The full diagnostic graph still runs with PostgreSQL, Prometheus, and Sentry enabled.

Run it explicitly:

```bash
npm run test:real
```

The default suite skips this test unless `RUN_REAL_INTEGRATION=1` is set.

## Verification

```bash
npm test
npm run test:real
npm run typecheck
npm run lint
npm run build
```

The real suite requires Docker, network access to pull the mock container image and MCP packages, and Gemini API quota. It does not require a Sentry account or a live Sentry instance.
