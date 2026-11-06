import { Annotation } from "@langchain/langgraph";
import { generateText } from "ai";
import type { DataSourceMap } from "./datasource.config";
import type { DataSourceService } from "./datasource/datasource.service";
import type { SourceResult } from "./datasource/datasource.types";
import type { InvestigationPlanner } from "./investigation/planner";
import { formatSourceResultsForPrompt } from "./investigation/result-formatter";
import type { ToolExecutor } from "./mcp/mcp.interface";
import { getModel, type RegistryModelId } from "./model.registry";

export const DiagnosticState = Annotation.Root({
  issueNumber: Annotation<string>(),
  repo: Annotation<string>(),
  model: Annotation<RegistryModelId>(),
  issueDescription: Annotation<string>(),
  identifiers: Annotation<Record<string, string>>(),
  sourceResults: Annotation<Record<string, SourceResult>>(),
  report: Annotation<string>(),
});

export type DiagnosticStateValue = typeof DiagnosticState.State;

export interface DiagnosticNodeDependencies {
  readonly executeTool: ToolExecutor;
  readonly sources: DataSourceMap;
  readonly dataSourceService: DataSourceService;
  readonly planner: InvestigationPlanner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
  const parsed: unknown = JSON.parse(fenced?.[1] ?? text.trim());
  return isRecord(parsed) ? parsed : {};
}

function toIdentifiers(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
        ? [[key, String(entry)]]
        : []
    )
  );
}

export function createFetchIssueNode({
  executeTool,
}: DiagnosticNodeDependencies) {
  return async function fetchIssueNode(state: DiagnosticStateValue) {
    const [owner, repo] = state.repo.split("/");
    const issueNumber = Number.parseInt(state.issueNumber, 10);

    if (!owner || !repo || !Number.isInteger(issueNumber)) {
      throw new Error(
        `Invalid issue reference: expected "owner/repo" and a numeric issue number`
      );
    }

    const result = await executeTool("get_issue", {
      owner,
      repo,
      issue_number: issueNumber,
    });

    return { issueDescription: result.text };
  };
}

export function createExtractIdentifiersNode() {
  return async function extractIdentifiersNode(state: DiagnosticStateValue) {
    const { text } = await generateText({
      model: getModel(state.model),
      prompt: `Extract identifiers from this issue as JSON only.
Fields: customerId, userId, transactionId, errorCode. Omit missing fields.

Issue:
${state.issueDescription}`,
    });

    try {
      return { identifiers: toIdentifiers(parseJsonObject(text)) };
    } catch {
      return { identifiers: {} };
    }
  };
}

export function createInvestigateSourcesNode({
  dataSourceService,
  planner,
  sources,
}: DiagnosticNodeDependencies) {
  return async function investigateSourcesNode(state: DiagnosticStateValue) {
    const selectedSources = await planner.selectSources({
      issueDescription: state.issueDescription,
      identifiers: state.identifiers,
      sources,
    });
    const sourceResults = await dataSourceService.investigate(
      selectedSources,
      state.identifiers
    );

    return { sourceResults };
  };
}

export function createGenerateReportNode() {
  return async function generateReportNode(state: DiagnosticStateValue) {
    const { text } = await generateText({
      model: getModel(state.model),
      prompt: `Write a diagnostic report.

Issue #${state.issueNumber} - ${state.repo}
Description: ${state.issueDescription}
Identifiers: ${JSON.stringify(state.identifiers)}
Source Results:
${formatSourceResultsForPrompt(state.sourceResults ?? {})}

Use only the evidence above. Treat each source result as evidence and name its source.
State when a datasource returned no results, failed, or was unavailable.
Do not present hypotheses as observed evidence.
Format: Summary | Root Cause | Evidence | Recommended Fix | Confidence (High/Medium/Low)`,
    });

    return { report: text };
  };
}
