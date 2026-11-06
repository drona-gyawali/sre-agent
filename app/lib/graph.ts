import { END, StateGraph } from "@langchain/langgraph";
import {
  DiagnosticState,
  createExtractIdentifiersNode,
  createFetchIssueNode,
  createGenerateReportNode,
  createInvestigateSourcesNode,
  type DiagnosticNodeDependencies,
} from "./utils";

export type DiagnosticNodeKey =
  | "fetch_issue"
  | "extract_identifiers"
  | "investigate_sources"
  | "generate_report";

export function buildDiagnosticGraph(dependencies: DiagnosticNodeDependencies) {
  return new StateGraph(DiagnosticState)
    .addNode("fetch_issue", createFetchIssueNode(dependencies))
    .addNode("extract_identifiers", createExtractIdentifiersNode())
    .addNode("investigate_sources", createInvestigateSourcesNode(dependencies))
    .addNode("generate_report", createGenerateReportNode())
    .addEdge("__start__", "fetch_issue")
    .addEdge("fetch_issue", "extract_identifiers")
    .addEdge("extract_identifiers", "investigate_sources")
    .addEdge("investigate_sources", "generate_report")
    .addEdge("generate_report", END)
    .compile();
}
