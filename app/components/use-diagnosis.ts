"use client";

import { useCallback, useRef, useState } from "react";

export type SourceResultStatus = "success" | "partial" | "failed";

export interface SourceResultView {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly integrationType: string;
  readonly category: string;
  readonly status: SourceResultStatus;
  readonly data: unknown;
  readonly query?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface DiagnosticStep {
  readonly node: string;
  readonly update: Record<string, unknown>;
}

export const NODE_ORDER = [
  "fetch_issue",
  "extract_identifiers",
  "investigate_sources",
  "generate_report",
] as const;

export const NODE_META: Record<
  string,
  { label: string; description: string; short: string }
> = {
  fetch_issue: {
    label: "Fetch issue",
    short: "Issue",
    description: "Loading issue context and repository metadata through GitHub MCP.",
  },
  extract_identifiers: {
    label: "Extract identifiers",
    short: "Entities",
    description:
      "Finding customer, transaction, service, and error identifiers in the incident.",
  },
  investigate_sources: {
    label: "Investigate sources",
    short: "Evidence",
    description:
      "Planning the investigation and querying the relevant data sources.",
  },
  generate_report: {
    label: "Generate report",
    short: "Report",
    description: "Synthesizing the observed evidence into a root-cause report.",
  },
  done: {
    label: "Complete",
    short: "Done",
    description: "Investigation completed.",
  },
  error: {
    label: "Stopped",
    short: "Error",
    description: "The investigation stopped before completing.",
  },
};

export function parseSourceResults(
  steps: readonly DiagnosticStep[]
): SourceResultView[] {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const results = steps[index]?.update.sourceResults;

    if (results && typeof results === "object" && !Array.isArray(results)) {
      return Object.values(results as Record<string, SourceResultView>);
    }
  }

  return [];
}

export function formatEvidence(value: unknown): string {
  if (value === null || value === undefined) return "No data returned.";
  if (typeof value === "string") return value || "No data returned.";

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function useDiagnosis() {
  const [steps, setSteps] = useState<DiagnosticStep[]>([]);
  const [report, setReport] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (message: string, model: string) => {
      const trimmed = message.trim();
      if (!trimmed || running) return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setSteps([]);
      setReport("");
      setError("");
      setRunning(true);

      try {
        const response = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, model }),
          signal: controller.signal,
        });

        if (!response.body) {
          throw new Error(
            response.ok
              ? "The diagnostic stream was empty"
              : `Diagnostic endpoint returned ${response.status}`
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleLine = (raw: string) => {
          const line = raw.trim();
          if (!line.startsWith("data:")) return;

          let payload: DiagnosticStep;
          try {
            payload = JSON.parse(line.slice(5).trim()) as DiagnosticStep;
          } catch {
            return;
          }

          if (payload.node === "error") {
            const message =
              typeof payload.update.error === "string"
                ? payload.update.error
                : String(payload.update.error);
            setError(message);
            return;
          }

          setSteps((previous) => [...previous, payload]);

          if (
            payload.node === "generate_report" &&
            typeof payload.update.report === "string"
          ) {
            setReport(payload.update.report);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");

          while (newline >= 0) {
            handleLine(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) handleLine(buffer);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(
          caught instanceof Error ? caught.message : "The investigation failed"
        );
      } finally {
        setRunning(false);
      }
    },
    [running]
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setRunning(false);
  }, []);

  return { steps, report, running, error, run, stop };
}
