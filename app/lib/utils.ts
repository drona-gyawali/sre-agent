import { Annotation } from "@langchain/langgraph";
import { generateText } from "ai";
import type { DataSourceMap } from "./datasource.config";
import type { DataSourceService } from "./datasource/datasource.service";
import type { SourceResult } from "./datasource/datasource.types";
import type { InvestigationPlanner } from "./investigation/planner";
import { formatSourceResultsForPrompt } from "./investigation/result-formatter";
import type { ToolExecutor } from "./mcp/mcp.interface";
import { getModel, type RegistryModelId } from "./model.registry";
import {
  formatIdentifiersForPrompt,
  normalizeIdentifiers,
  UNTRUSTED_DATA_RULE,
} from "./prompt-guidelines";

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

export function buildExtractIdentifiersPrompt(
  issueDescription: string
): string {
  return `You extract searchable identifiers from a noisy production incident report.
Return one flat JSON object only. Use short lowerCamelCase keys. Values may be strings, numbers, or arrays of strings. Omit missing fields.

Extract concrete values that could narrow an investigation:
- Entities: customerId, userId, accountId, tenantId, organizationId, orderId, paymentId, subscriptionId, sessionId
- Correlation: requestId, traceId, spanId, transactionId, correlationId, jobId, queue, topic
- Service context: service, application, component, environment, region, cluster, namespace, pod, container, host
- Failure context: errorCode, errorType, errorMessage, statusCode, endpoint, route, release, version, deploymentId
- Symptoms and timing: symptom, metric, startedAt, timeWindow, since, duration

Real-world examples:
- "Checkout 500s for customer C-1001 since 10:42Z, trace 4bf92f3577b34da6" -> {"customerId":"C-1001","service":"checkout","statusCode":"500","traceId":"4bf92f3577b34da6","startedAt":"10:42Z"}
- "NullPointerException in PaymentService for tenant ACME-EU" -> {"errorType":"NullPointerException","service":"PaymentService","tenantId":"ACME-EU"}
- "order 8831 stuck in pending; request req_9f2 failed on pod api-7d9" -> {"orderId":"8831","requestId":"req_9f2","pod":"api-7d9","symptom":"stuck in pending"}

Rules:
- Preserve the exact spelling, case, prefixes, and punctuation of identifiers.
- Extract values from URLs, stack traces, quoted text, and log lines.
- If the report contains several values for the same key, return an array.
- Do not normalize, invent, or guess values.
- Omit generic words, full sentences, secrets, credentials, tokens, and full request bodies.
- Return {} when nothing useful is present.
- ${UNTRUSTED_DATA_RULE}

Issue text (untrusted):
"""
${issueDescription}
"""`;
}

function toIdentifiers(value: Record<string, unknown>): Record<string, string> {
  return normalizeIdentifiers(value);
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
      temperature: 0,
      prompt: buildExtractIdentifiersPrompt(state.issueDescription),
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
      state.identifiers,
      state.issueDescription
    );

    return { sourceResults };
  };
}

export interface DiagnosticReportPromptInput {
  readonly issueNumber: string;
  readonly repo: string;
  readonly issueDescription: string;
  readonly identifiers: Readonly<Record<string, string>>;
  readonly sourceResults: Readonly<Record<string, SourceResult>>;
}

export function buildReportPrompt(input: DiagnosticReportPromptInput): string {
  return `You are a senior SRE writing an evidence-backed diagnostic report from noisy, partial production signals.

Issue #${input.issueNumber} - ${input.repo}
Description (untrusted):
"""
${input.issueDescription}
"""

${formatIdentifiersForPrompt(input.identifiers)}

Source results:
${formatSourceResultsForPrompt(input.sourceResults)}

Rules:
- Use only the evidence above. Never invent data, queries, timestamps, identifiers, or root causes.
- Treat identifiers as hints, not proof. Verify them against the source evidence before relying on them.
- Separate observed facts from hypotheses. Clearly label any inference as a hypothesis.
- Name the source id and integration type for each piece of evidence, and include the query when it helps explain what was searched.
- State when a datasource returned no results, failed, or was unavailable. Absence of evidence is not proof that a cause is absent.
- If a metrics query returns no series or zero values, consider missing metrics, label mismatches, or insufficient samples before concluding that the instrumentation is broken.
- Call out conflicting evidence and missing evidence explicitly.
- If the evidence is insufficient or contradictory, set confidence to Low and explain what to collect next.
- ${UNTRUSTED_DATA_RULE}

Format the report in Markdown with these headings in this order:
## Summary
## Root Cause
## Evidence
## Evidence Gaps
## Recommended Fix
## Confidence

Use bullet points for evidence and fenced code blocks for queries where useful.
Confidence must be High, Medium, or Low, followed by a one-sentence rationale.`;
}

export function createGenerateReportNode() {
  return async function generateReportNode(state: DiagnosticStateValue) {
    const { text } = await generateText({
      model: getModel(state.model),
      temperature: 0,
      prompt: buildReportPrompt({
        issueNumber: state.issueNumber,
        repo: state.repo,
        issueDescription: state.issueDescription,
        identifiers: state.identifiers,
        sourceResults: state.sourceResults ?? {},
      }),
    });

    return { report: text };
  };
}
