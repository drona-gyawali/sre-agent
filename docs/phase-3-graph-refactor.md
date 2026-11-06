# Phase 3: Graph Refactor

This document records the graph refactor that turns source investigation into a planned, bounded, normalized workflow.

Phase 2 introduced the adapter architecture and the generic `investigate_sources` node. Phase 3 completes the graph refactor by adding dynamic source selection, bounded parallel execution, and normalized report formatting.

## Goals

- Create and use the `investigate_sources` node.
- Remove hardcoded `database` and `logs` investigation nodes.
- Select relevant sources dynamically instead of querying every enabled source.
- Execute selected sources with bounded parallelism.
- Generate the report from normalized `SourceResult` objects.

## Dynamic source selection

Defined in `app/lib/investigation/planner.ts`:

```typescript
interface InvestigationPlanner {
  selectSources(
    input: SourceSelectionInput
  ): Promise<readonly DataSourceConfig[]>;
}
```

`SourceSelectionInput` contains:

- The GitHub issue description.
- Extracted identifiers.
- The configured datasource map.

`LlmInvestigationPlanner` asks the configured model to choose relevant source IDs:

- Only enabled sources are shown to the model.
- Unknown, duplicate, and disabled source IDs are ignored.
- Returned IDs are resolved back to configuration objects in configuration order.
- Invalid JSON, model failures, empty selections, and selections with no valid enabled IDs fall back to all enabled sources.
- If no sources are enabled, the planner returns an empty list without calling the model.

The planner is independent of specific source IDs. Adding a new configured source does not require graph changes.

## Bounded parallel execution

`DataSourceService` now accepts a `concurrency` option:

```typescript
new DataSourceService({
  registry,
  executeTool,
  model,
  concurrency: 4,
});
```

Behavior:

- Default concurrency is `DEFAULT_SOURCE_CONCURRENCY` (`4`).
- A positive integer limits the number of simultaneous source investigations.
- `1` forces sequential execution.
- Zero, negative, fractional, or `NaN` values fail with a clear `DataSourceConfigError`.
- Result order follows the selected source order even when completion order differs.
- Each source still normalizes its own failure; one failure does not reject the investigation.

`app/lib/agent.ts` reads an optional `SOURCE_INVESTIGATION_CONCURRENCY` environment variable. Invalid values fall back to the service default.

## Graph changes

`app/lib/graph.ts` remains integration-agnostic:

```text
START
  -> fetch_issue
  -> extract_identifiers
  -> investigate_sources
  -> generate_report
  -> END
```

`app/lib/utils.ts` now:

- Receives an `InvestigationPlanner` dependency.
- Calls `planner.selectSources` with the issue description, identifiers, and configured sources.
- Passes only the selected sources to `DataSourceService.investigate`.
- Stores the normalized results in `sourceResults`.

There are no `query_database` or `check_logs` nodes and no `ENABLE_DB` or `ENABLE_LOGS` graph branching.

## Normalized report generation

`app/lib/investigation/result-formatter.ts` formats `sourceResults` for the report prompt.

Each result is rendered with:

- Source ID, name, category, and integration type.
- Status and duration.
- Generated query when available.
- Evidence for successful results.
- Error text for failed results.

When no sources were selected or enabled, the report prompt states that explicitly. The prompt also distinguishes observed evidence from hypotheses.

## Tests

Phase 3 adds or updates:

- `tests/unit/investigation-planner.test.ts`: enabled-source filtering, valid IDs, unknown/duplicate IDs, fenced JSON, invalid JSON, model failures, empty selections, and disabled sources.
- `tests/unit/datasource-service.test.ts`: default and explicit concurrency bounds, sequential mode, invalid concurrency, and existing failure normalization.
- `tests/unit/diagnostic-graph.test.ts`: planner-driven source selection, report formatting of success/failure evidence, empty-source reporting, generic graph structure, and full workflow state.
- `tests/integration/sqlite-mcp.test.ts`: normalized SQLite investigation through the registry, adapter, service, and real MCP server.

Run the suite with:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
