import type { SourceResult } from "../datasource/datasource.types";

function formatSourceResult(result: SourceResult): string {
  const lines = [
    `[${result.sourceId}] ${result.sourceName} (${result.category}, ${result.integrationType})`,
    `Status: ${result.status} (${result.durationMs}ms)`,
  ];

  if (result.query) {
    lines.push(`Query: ${result.query}`);
  }

  if (result.status === "failed") {
    lines.push(`Error: ${result.error ?? "Unknown failure"}`);
  } else {
    lines.push(`Evidence: ${JSON.stringify(result.data)}`);
  }

  return lines.join("\n");
}

export function formatSourceResultsForPrompt(
  sourceResults: Readonly<Record<string, SourceResult>>
): string {
  const results = Object.values(sourceResults);

  if (results.length === 0) {
    return "No data sources were selected or enabled for this investigation.";
  }

  return results.map(formatSourceResult).join("\n\n");
}
