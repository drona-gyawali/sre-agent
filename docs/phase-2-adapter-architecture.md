# Phase 2: Adapter Architecture

This document records the Phase 2 changes that turn datasource execution into a configuration-driven adapter architecture.

Phase 1 established the MCP execution foundation and validated SQLite datasource configuration. Phase 2 moves datasource-specific behavior behind adapters so the diagnostic graph no longer knows whether a source is SQLite, PostgreSQL, Prometheus, or anything else.

## Goals

- Define a common `DataSourceAdapter` contract.
- Normalize discovery and query results.
- Resolve adapters through a registry instead of conditionals.
- Centralize datasource execution in a generic service.
- Move SQLite discovery and query logic into the SQL adapter.
- Replace the hardcoded `database` and `logs` graph nodes with one generic investigation node.
- Replace `dbResult` and `logsResult` state with `sourceResults`.

## Shared types

Defined in `app/lib/datasource/datasource.types.ts`:

- `IntegrationType`: supported integration identifiers (`sqlite`, `postgres`, `mysql`, `clickhouse`, `prometheus`, `loki`, `sentry`).
- `SourceCategory`: logical category (`database`, `logs`, `metrics`, `error_tracking`).
- `DiscoveryColumn` / `DiscoveryTable` / `DiscoveryResult`: normalized schema discovery.
- `AdapterQueryResult`: what an adapter returns after executing a query.
- `SourceResult`: the normalized result consumed by the graph and report generator.
- `SourceStatus`: `success`, `partial`, or `failed`.

Every `SourceResult` includes:

```typescript
interface SourceResult {
  sourceId: string;
  sourceName: string;
  integrationType: IntegrationType;
  category: SourceCategory;
  status: "success" | "partial" | "failed";
  data: unknown;
  query?: string;
  error?: string;
  durationMs: number;
}
```

A failed source has `status: "failed"`, `data: null`, and an `error` string. An empty successful response remains `status: "success"` with `data: "No results"`, so failures and empty results are distinguishable.

## Adapter contract

Defined in `app/lib/datasource/datasource.interface.ts`:

```typescript
interface DataSourceAdapter {
  readonly type: IntegrationType;

  discover(
    source: DataSourceConfig,
    executor: ToolExecutor
  ): Promise<DiscoveryResult>;

  query(
    input: QueryInput,
    executor: ToolExecutor
  ): Promise<AdapterQueryResult>;
}
```

`QueryInput` carries the source configuration, extracted identifiers, and the selected model. Adapters receive the existing `ToolExecutor`; they do not create MCP clients themselves.

## Adapter registry

`app/lib/datasource/datasource.registry.ts` provides `DataSourceRegistry`:

- `register(adapter)` registers one adapter per integration type.
- `resolve(type)` returns the adapter or throws a clear `DataSourceConfigError`.
- `has(type)` checks availability.
- `registeredTypes` exposes registered integration types.

`createDefaultDataSourceRegistry()` registers the SQLite dialect with the SQL adapter:

```text
sqlite -> SqlAdapter(SQLite dialect)
```

Adding an adapter later does not require changing the diagnostic graph.

## Generic datasource service

`app/lib/datasource/datasource.service.ts` provides `DataSourceService`:

- `discover(source)` resolves the adapter and performs schema discovery.
- `query(source, params)` resolves the adapter, executes the query, and returns a normalized `SourceResult`.
- `investigateSource(source, params)` wraps execution failures into a failed `SourceResult` instead of throwing.
- `investigate(sources, params)` runs all enabled sources concurrently and returns a `Record<string, SourceResult>` keyed by source ID.

The service filters disabled sources during investigation. One source failing does not prevent other sources from producing results.

## SQL adapter

`app/lib/datasource/adapters/sql/` contains the SQL implementation:

- `sql.adapter.ts`: `SqlAdapter`, dialect definition, SQL cleanup, and result normalization.
- `sql.schema.ts`: table/column parsing, discovery orchestration, and prompt schema formatting.

The SQLite-specific discovery behavior from Phase 1 now lives here:

1. Call the configured `listTables` tool.
2. Parse table names from arrays, `{ name }` objects, and empty-database responses.
3. Call `describeTable` once per table.
4. Normalize PRAGMA-style column metadata.
5. Render exact names into the SQL-generation prompt.
6. Execute the generated read-only query.
7. Parse JSON results when possible, otherwise retain the returned text.
8. Return `"No results"` for empty successful responses.

The adapter is constructed with a `SqlDialect`. Phase 2 registers `SQLITE_DIALECT`; later phases can add PostgreSQL or other SQL dialects without duplicating the generic SQL flow.

## Configuration changes

`app/lib/datasource.config.ts` now requires two datasource fields:

- `type`: the integration type used to resolve an adapter.
- `category`: the logical source category used in normalized results.

The previous `query_language` field was removed. The committed configuration is:

```json
{
  "database": {
    "name": "db",
    "type": "sqlite",
    "category": "database",
    "package": "mcp-sqlite",
    "mcp_tool": "db_query",
    "schema_tool": "db_list_tables",
    "column_tool": "db_get_table_schema",
    "env": {},
    "connection": "${DATABASE_PATH}",
    "enabled": true
  },
  "logs": {
    "name": "logs",
    "type": "sqlite",
    "category": "logs",
    "package": "mcp-sqlite",
    "mcp_tool": "logs_query",
    "schema_tool": "logs_list_tables",
    "column_tool": "logs_get_table_schema",
    "env": {},
    "connection": "${LOGS_PATH}",
    "enabled": true
  }
}
```

Unknown integration types and categories fail configuration validation. Known integration types without a registered adapter fail at investigation time with a normalized failed result.

## Graph changes

`app/lib/graph.ts` now uses one generic investigation node:

```text
START
  -> fetch_issue
  -> extract_identifiers
  -> investigate_sources
  -> generate_report
  -> END
```

`app/lib/utils.ts` changes:

- `DiagnosticState` replaces `dbResult` and `logsResult` with `sourceResults: Record<string, SourceResult>`.
- `createInvestigateSourcesNode` delegates all enabled sources to `DataSourceService.investigate`.
- `createGenerateReportNode` includes the normalized source results, including failures and errors.

There are no hardcoded `query_database` or `check_logs` nodes, and the graph does not branch on `ENABLE_DB` or `ENABLE_LOGS`. Configuration `enabled` flags and adapter availability control execution.

`app/lib/agent.ts` builds one `DataSourceService` per investigation with the default registry and the shared `McpSession` executor.

Phase 3 builds on this node by adding planner-based source selection, bounded concurrency, and normalized report formatting. See `docs/phase-3-graph-refactor.md`.

## Tests

Phase 2 test coverage includes:

- `tests/unit/datasource-registry.test.ts`: registration, duplicate adapters, unregistered types, default registry, multiple integration types.
- `tests/unit/datasource-service.test.ts`: normalization, partial results, disabled sources, unsupported adapters, independent failures, concurrency, empty investigations.
- `tests/unit/sql-adapter.test.ts`: schema-aware query generation, SQL cleanup, empty queries, JSON/text/empty results, discovery metadata.
- `tests/unit/sqlite-schema.test.ts`: table and column parsing, discovery orchestration, prompt formatting.
- `tests/unit/diagnostic-graph.test.ts`: generic investigation node, absence of old graph nodes, report prompt source results, full workflow state.
- `tests/unit/datasource.config.test.ts`: integration type/category validation and existing configuration checks.
- `tests/integration/sqlite-mcp.test.ts`: real `mcp-sqlite` discovery and query execution through the registry, adapter, and service, including normalized MCP failures.

Run the suite with:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
