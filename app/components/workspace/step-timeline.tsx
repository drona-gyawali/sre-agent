import { Check, LoaderCircle, Radar } from "lucide-react";
import {
  NODE_META,
  NODE_ORDER,
  type DiagnosticStep,
  type SourceResultView,
} from "@/app/components/use-diagnosis";
import { sourceDisplayName } from "@/app/components/source-icon";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";
import { cn } from "@/app/lib/cn";

type State = "done" | "active" | "pending";

function readRecord(
  update: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const value = update[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function identifierEntries(
  update: Record<string, unknown>
): Array<[string, string]> {
  const identifiers = readRecord(update, "identifiers");
  if (!identifiers) return [];

  return Object.entries(identifiers)
    .filter(
      ([, value]) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    )
    .slice(0, 6)
    .map(([key, value]) => [key, String(value)]);
}

function sourceEntries(update: Record<string, unknown>): SourceResultView[] {
  const results = readRecord(update, "sourceResults");
  if (!results) return [];

  return Object.values(results) as SourceResultView[];
}

export function StepTimeline({
  steps,
  running,
}: {
  steps: readonly DiagnosticStep[];
  running: boolean;
}) {
  if (steps.length === 0) {
    return (
      <Card className="border-dashed p-10 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground">
          <Radar className="h-5 w-5" />
        </span>
        <p className="mt-4 font-display text-[14px] font-semibold">
          No investigation yet
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
          Describe an incident above, then run the diagnosis. Each stage will
          appear here as the agent works through it.
        </p>
      </Card>
    );
  }

  const records = new Map<string, DiagnosticStep>();
  for (const step of steps) {
    if (step.node !== "done" && step.node !== "error") {
      records.set(step.node, step);
    }
  }

  const activeIndex = running
    ? NODE_ORDER.findIndex((node) => !records.has(node))
    : -1;

  return (
    <ol className="relative space-y-2.5">
      <span
        aria-hidden="true"
        className="absolute bottom-8 left-[15px] top-8 w-px bg-border"
      />

      {NODE_ORDER.map((node, index) => {
        const record = records.get(node);
        const state: State = record
          ? "done"
          : index === activeIndex
            ? "active"
            : "pending";
        const meta = NODE_META[node];
        const update = record?.update ?? {};
        const identifiers =
          node === "extract_identifiers" ? identifierEntries(update) : [];
        const sources =
          node === "investigate_sources" ? sourceEntries(update) : [];

        return (
          <li key={node} className="relative flex gap-3">
            <span
              className={cn(
                "relative z-10 mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors",
                state === "done" &&
                  "border-success/30 bg-success/10 text-success",
                state === "active" &&
                  "border-primary/40 bg-primary/10 text-primary",
                state === "pending" &&
                  "border-border bg-background text-muted-foreground"
              )}
            >
              {state === "done" ? (
                <Check className="h-3.5 w-3.5" />
              ) : state === "active" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span className="font-mono text-[10px]">{index + 1}</span>
              )}
            </span>

            <div
              className={cn(
                "flex-1 rounded-xl border p-3.5 transition-colors",
                state === "pending"
                  ? "border-dashed bg-transparent"
                  : "border-border bg-card",
                state === "active" && "border-primary/30 bg-primary/[0.03]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className={cn(
                    "text-[13px] font-semibold",
                    state === "pending" && "text-muted-foreground"
                  )}
                >
                  {meta.label}
                </p>
                <Badge
                  variant={
                    state === "done"
                      ? "success"
                      : state === "active"
                        ? "default"
                        : "muted"
                  }
                  className="capitalize"
                >
                  {state === "done"
                    ? "Complete"
                    : state === "active"
                      ? "Running"
                      : "Queued"}
                </Badge>
              </div>

              <p
                className={cn(
                  "mt-1 text-[12px] leading-relaxed",
                  state === "pending"
                    ? "text-muted-foreground/60"
                    : "text-muted-foreground"
                )}
              >
                {meta.description}
              </p>

              {identifiers.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {identifiers.map(([key, value]) => (
                    <span
                      key={`${key}-${value}`}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px]"
                    >
                      <span className="text-muted-foreground">{key}</span>
                      <span className="text-foreground">{value}</span>
                    </span>
                  ))}
                </div>
              ) : null}

              {sources.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {sources.map((source) => (
                    <span
                      key={source.sourceId}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium",
                        source.status === "success" &&
                          "border-success/25 bg-success/10 text-success",
                        source.status === "partial" &&
                          "border-warning/25 bg-warning/10 text-warning",
                        source.status === "failed" &&
                          "border-destructive/25 bg-destructive/10 text-destructive"
                      )}
                    >
                      <span className="h-1 w-1 rounded-full bg-current" />
                      {sourceDisplayName({
                        id: source.sourceId,
                        name: source.sourceName,
                      })}
                      <span className="font-mono opacity-70">
                        {source.status}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
