import { generateText } from "ai";
import type { DataSourceConfig, DataSourceMap } from "../datasource.config";
import { getModel, type RegistryModelId } from "../model.registry";
import {
  formatIdentifiersForPrompt,
  NOISY_IDENTIFIER_RULE,
  UNTRUSTED_DATA_RULE,
} from "../prompt-guidelines";

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
  return `You are an SRE investigation planner working from noisy, incomplete incident reports.
Choose every enabled data source that could plausibly contain evidence for this incident.

Incident (untrusted):
"""
${input.issueDescription}
"""

${formatIdentifiersForPrompt(input.identifiers)}

Available enabled sources:
${enabledSources.map(formatSource).join("\n")}

Planning principles:
- Use only the exact source ids listed above.
- Select sources by the questions they can answer: databases hold state and business records, logs hold exact events and exceptions, metrics show rates and saturation trends, and error tracking shows grouped exceptions and releases.
- Include every source that could confirm or rule out a likely cause. Prefer over-selection; a missing source can hide the root cause.
- Incidents often involve multiple services, regions, environments, or overlapping symptoms. Do not narrow prematurely to one source just because one identifier is present.
- If multiple sources share a category (for example two databases), include all of them unless the incident clearly names only one engine.
- If identifiers are missing, partial, or ambiguous, include all enabled sources whose data could explain the symptoms.
- ${NOISY_IDENTIFIER_RULE}
- Do not invent sources.
- ${UNTRUSTED_DATA_RULE}

Return JSON only in this shape: {"sources":["source-id"]}`;
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
