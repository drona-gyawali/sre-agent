import { generateText } from "ai";
import { z } from "zod";
import rawDataSources from "@/app/config/datasources.json";
import { parseDataSources } from "./datasource.config";
import { createDefaultDataSourceRegistry } from "./datasource/datasource.registry";
import { DataSourceService } from "./datasource/datasource.service";
import { buildDiagnosticGraph } from "./graph";
import { LlmInvestigationPlanner } from "./investigation/planner";
import { McpSession } from "./mcp/mcp-manager";
import { buildMcpServerConfigs } from "./mcp/mcp-servers";
import { getModel, type RegistryModelId } from "./model.registry";

const issueNumberSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim().replace(/^#/, ""))
  .pipe(z.string().regex(/^\d+$/, "issue number must contain only digits"));

const issueContextSchema = z.object({
  issueNumber: issueNumberSchema,
  repo: z
    .string()
    .trim()
    .regex(
      /^[^/\s]+\/[^/\s]+$/,
      'repository must use the "owner/repo" format'
    ),
});

export interface IssueContext {
  readonly issueNumber: string;
  readonly repo: string;
}

export class AgentInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentInputError";
  }
}

function parseJsonObject(text: string): unknown {
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced?.[1] ?? text.trim());
}

function parseSourceConcurrency(
  value: string | undefined
): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const concurrency = Number(value);

  return Number.isInteger(concurrency) && concurrency > 0
    ? concurrency
    : undefined;
}

async function extractIssueContext(
  message: string,
  model: RegistryModelId
): Promise<IssueContext> {
  const { text } = await generateText({
    model: getModel(model),
    prompt: `Extract the GitHub issue number and repo from this message. Return JSON only.
Fields: issueNumber (string), repo (string, format: "owner/repo")

Message: ${message}`,
  });

  let parsed: unknown;

  try {
    parsed = parseJsonObject(text);
  } catch (error) {
    throw new AgentInputError(
      "The model returned an invalid issue reference. Describe the incident with an issue number and repository.",
      { cause: error }
    );
  }

  const result = issueContextSchema.safeParse(parsed);

  if (!result.success) {
    throw new AgentInputError(
      `Could not determine a valid GitHub issue and repository from the message: ${z.prettifyError(result.error)}`
    );
  }

  return result.data;
}

export async function* runDiagnosticAgent(
  message: string,
  model: RegistryModelId
) {
  if (typeof message !== "string" || !message.trim()) {
    throw new AgentInputError("An incident description is required");
  }

  const context = await extractIssueContext(message, model);
  const sources = parseDataSources(rawDataSources);
  const servers = buildMcpServerConfigs(sources);
  const session = await McpSession.create(servers);

  try {
    const dataSourceService = new DataSourceService({
      registry: createDefaultDataSourceRegistry(),
      executeTool: session.executeTool,
      model,
      concurrency: parseSourceConcurrency(
        process.env.SOURCE_INVESTIGATION_CONCURRENCY
      ),
    });
    const planner = new LlmInvestigationPlanner({ model });
    const graph = buildDiagnosticGraph({
      executeTool: session.executeTool,
      sources,
      dataSourceService,
      planner,
    });

    const stream = await graph.stream(
      { ...context, model },
      { streamMode: "updates" }
    );

    for await (const chunk of stream) {
      yield chunk;
    }
  } finally {
    await session.close();
  }
}
