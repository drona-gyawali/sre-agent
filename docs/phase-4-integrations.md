# Phase 4: Integrations (PostgreSQL & Prometheus)

This document records the addition of PostgreSQL and Prometheus integrations to the extensible SRE diagnostic agent architecture.

Building on the Phase 2 adapter contract and Phase 3 graph refactor, Phase 4 demonstrates that new database and metric integrations can be added purely via config and dedicated adapter implementations without altering the LangGraph workflow structure.

## Goals

- Support PostgreSQL as a database integration type.
- Support Prometheus as a metrics integration type.
- Provide config schema expansion and settings normalization (time ranges, query steps).
- Maintain dynamic schema discovery and query generation for each integration.
- Ensure integration isolation so that failure in one source does not impact others.
- Prove that zero LangGraph node or edge modifications are required to add new integrations.

## Architecture & Adapters

### 1. Extensible Configuration (`app/lib/datasource.config.ts`)

Datasource locations and service URLs are supplied through `.env` (see `.env.example`) instead of being hardcoded in `app/config/datasources.json`:

```bash
DATABASE_PATH=data/database.db
LOGS_PATH=data/logs.db
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/postgres
PROMETHEUS_URL=http://localhost:9090
```

The runtime SQLite files live in `data/`, outside the application source tree.

`DataSourceConfig` was generalized to support various tool sets and execution settings:

- Optional connection strings (required for `sqlite` file paths and `postgres` connection URIs; omitted for `prometheus` when managed via environment variables like `PROMETHEUS_URL`).
- Tool name overrides: `schema_tool`, `column_tool`, `discover_tool`, `range_tool`.
- Execution settings: `settings` object containing `timeRangeMinutes` (default 60) and `stepSeconds` (default 60).

Committed example entries were added to `app/config/datasources.json`:
- `postgres`: disabled example pointing to `@modelcontextprotocol/server-postgres`.
- `metrics`: disabled example pointing to `prometheus-mcp-server`.

### 2. PostgreSQL Adapter (`app/lib/datasource/adapters/sql/`)

- Implemented via `SqlAdapter` configured with `POSTGRES_DIALECT`.
- Supports schema discovery using PostgreSQL tools (`listTables`, `describeTable` with `{ table_name }` arguments) or falling back to SQL queries against `information_schema.tables` and `information_schema.columns`.
- Handles column primary keys, nullability, and data types via `parseTableColumnsByTable`.
- Prompts LLM for PostgreSQL-specific SQL generation.

### 3. Prometheus Adapter (`app/lib/datasource/adapters/prometheus/prometheus.adapter.ts`)

- Implemented in `PrometheusAdapter` (`type = "prometheus"`).
- Schema discovery (`discover`) invokes `prom_discover` if configured to extract metric names.
- PromQL generation uses `cleanGeneratedQuery` to strip markdown formatting.
- Executes range queries (`rangeQuery` tool) with window bounds computed from `settings.timeRangeMinutes` and `settings.stepSeconds` when configured, or instant queries (`query` tool) otherwise.
- Output data is parsed into structured objects or preserved as text via `normalizeSourceData`.

### 4. Adapter Registry (`app/lib/datasource/datasource.registry.ts`)

`createDefaultDataSourceRegistry()` registers default adapters:
- `SqlAdapter(SQLITE_DIALECT)` for `"sqlite"`
- `SqlAdapter(POSTGRES_DIALECT)` for `"postgres"`
- `PrometheusAdapter` for `"prometheus"`

### 5. Graph Immutability (`app/lib/graph.ts`)

The diagnostic graph topology remains 100% unchanged:
```text
START -> fetch_issue -> extract_identifiers -> investigate_sources -> generate_report -> END
```
Adding PostgreSQL and Prometheus datasources required zero node additions, zero edge modifications, and zero graph branching. `investigate_sources` uses `DataSourceService` to run queries concurrently regardless of integration type.

## Verification & Tests

Phase 4 adds comprehensive unit and integration coverage across 119 default tests, plus 7 real Docker-backed tests:

- `tests/unit/datasource.config.test.ts`: Postgres and Prometheus config validation, settings defaults, missing connection checks.
- `tests/unit/datasource-registry.test.ts`: Default registry resolution for SQLite, PostgreSQL, and Prometheus.
- `tests/unit/mcp-servers.test.ts`: Server command arguments for Postgres connection URIs and Prometheus environment variables.
- `tests/unit/sqlite-schema.test.ts`: PostgreSQL `information_schema` discovery parsing and column grouping.
- `tests/unit/sql-adapter.test.ts`: PostgreSQL SQL generation and query execution with mocked tools.
- `tests/unit/prometheus-adapter.test.ts`: Metric name extraction, PromQL range/instant query construction, bounded time windows.
- `tests/unit/datasource-service-integrations.test.ts`: Full service investigation across PostgreSQL and Prometheus sources with mocked executors and failure isolation.
- `tests/unit/datasource-health.test.ts`: Health checker status derivation, disabled-source handling, Postgres/Prometheus check delegation, and degraded/down aggregation.
- `tests/unit/diagnostic-graph.test.ts`: Proves the generic graph retains identical node structure for PostgreSQL and Prometheus datasources.
- `tests/integration/real-datasources.test.ts`: Real Docker-backed integration coverage using live PostgreSQL, Prometheus, Pushgateway, real MCP servers, and the configured Gemini model.

## Real infrastructure integration tests

The real integration suite starts its own Docker Compose stack from `tests/integration/fixtures/docker-compose.yml`:

- PostgreSQL 16, seeded from `tests/integration/fixtures/postgres-init.sql`.
- Prometheus 3.5, configured by `tests/integration/fixtures/prometheus.yml`.
- Pushgateway, used to publish deterministic `sre_agent_*` metrics.

The suite then:

- Starts `@modelcontextprotocol/server-postgres` and `prometheus-mcp-server` as real stdio MCP servers.
- Discovers the PostgreSQL schema through `information_schema`.
- Discovers live Prometheus metric names.
- Verifies the datasource health checker against live PostgreSQL and Prometheus.
- Uses Gemini to generate and execute a real SQL query and a real PromQL range query.
- Runs the complete diagnostic graph with real MCP-backed datasources.

Run the real suite explicitly:

```bash
npm run test:real
```

The default suite (`npm test`) skips this suite unless `RUN_REAL_INTEGRATION=1` is set.

Run all verification checks:

```bash
npm test
npm run test:real
npm run typecheck
npm run lint
npm run build
```

## Environment Enable Flags

Every data source in `app/config/datasources.json` now uses environment variable flags for its `enabled` property:

- `ENABLE_DATABASE=${ENABLE_DATABASE:-true}`
- `ENABLE_LOGS=${ENABLE_LOGS:-true}`
- `ENABLE_POSTGRES=${ENABLE_POSTGRES:-false}`
- `ENABLE_PROMETHEUS=${ENABLE_PROMETHEUS:-false}`

Disabled sources gracefully omit missing connection and environment variables during configuration loading.

## Health Check API (`/api/health`)

A health check API is available at `GET /api/health`:

- Evaluates enabled status and reachability for all configured sources.
- SQLite: checks file existence.
- PostgreSQL: tests connection via `SELECT 1`.
- Prometheus: checks `/-/healthy` endpoint via HTTP.
- Returns `200 OK` when all enabled sources are healthy or status is `"ok"`.
- Returns `503 Service Unavailable` when any enabled source is `"down"` (`"degraded"` or `"down"` status).

Sample response:
```json
{
  "status": "ok",
  "checkedAt": "2026-11-07T00:00:00.000Z",
  "sources": [
    {
      "id": "database",
      "name": "db",
      "type": "sqlite",
      "category": "database",
      "enabled": true,
      "status": "up",
      "latencyMs": 1,
      "detail": "Datasource is reachable"
    }
  ]
}
```
