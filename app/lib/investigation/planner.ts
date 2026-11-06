import { generateText } from "ai";
import type { DataSourceConfig, DataSourceMap } from "../datasource.config";
import { getModel, type RegistryModelId } from "../model.registry";

export interface SourceSelectionInput {
  readonly issueDescription: string;
  readonly identifiers: Readonly<Record<string, string>>;
  readonly sources: DataSourceMap;
}

export interface InvestigationPlanner {
  selectSources(
    input: SourceSelectionInput
  ): Promise<readonly DataSourceConfig[]>;
}

export interface LlmInvestigationPlannerOptions {
  readonly model: RegistryModelId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonValue(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function readSelectedIds(text: string): readonly string[] | undefined {
  let parsed: unknown;

  try {
    parsed = parseJsonValue(text);
  } catch {
    return undefined;
  }

  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed)
      ? (parsed.sources ?? parsed.sourceIds ?? parsed.source_ids)
      : undefined;

  if (!Array.isArray(raw)) {
    return undefined;
  }

  return raw.flatMap((entry) =>
    typeof entry === "string" && entry.trim() ? [entry.trim()] : []
  );
}

function formatSource(source: DataSourceConfig): string {
  return [
    `- id: ${source.id}`,
    `name: ${source.name}`,
    `category: ${source.category}`,
    `type: ${source.type}`,
    `tools: ${Object.values(source.tools).join(", ")}`,
  ].join(", ");
}

function buildSelectionPrompt(
  input: SourceSelectionInput,
  enabledSources: readonly DataSourceConfig[]
): string {
  return `You are an SRE investigation planner.
Choose the enabled data sources that are likely to contain evidence for this incident.

Incident:
${input.issueDescription}

Identifiers: ${JSON.stringify(input.identifiers)}

Available enabled sources:
${enabledSources.map(formatSource).join("\n")}

Rules:
- Use only the exact source ids listed above.
- Prefer including a source over omitting it; a missing source can hide the root cause.
- Select every source that could plausibly contain one of the identifiers.
- If multiple sources share a category (for example two databases), include all of them unless the incident clearly names only one engine.
- Database, logs, and metrics evidence are complementary; include all that could explain the incident.
- Do not invent sources.
- Return JSON only in this shape: {"sources":["source-id"]}`;
}

export class LlmInvestigationPlanner implements InvestigationPlanner {
  private readonly model: RegistryModelId;

  constructor(options: LlmInvestigationPlannerOptions) {
    this.model = options.model;
  }

  async selectSources(
    input: SourceSelectionInput
  ): Promise<readonly DataSourceConfig[]> {
    const enabled = Object.values(input.sources).filter(
      (source) => source.enabled
    );

    if (enabled.length === 0) {
      return [];
    }

    let selectedIds: readonly string[] | undefined;

    try {
      const { text } = await generateText({
        model: getModel(this.model),
        temperature: 0,
        prompt: buildSelectionPrompt(input, enabled),
      });
      selectedIds = readSelectedIds(text);
    } catch {
      return enabled;
    }

    if (!selectedIds) {
      return enabled;
    }

    const selected = new Set(selectedIds);
    const relevant = enabled.filter((source) => selected.has(source.id));

    return relevant.length > 0 ? relevant : enabled;
  }
}
