import {
  AlertTriangle,
  ChevronDown,
  Database,
  FileText,
  Terminal,
} from "lucide-react";
import { SourceIcon, sourceDisplayName } from "@/app/components/source-icon";
import {
  formatEvidence,
  type SourceResultStatus,
  type SourceResultView,
} from "@/app/components/use-diagnosis";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";

const STATUS_VARIANT: Record<
  SourceResultStatus,
  "success" | "warning" | "destructive"
> = {
  success: "success",
  partial: "warning",
  failed: "destructive",
};

export function EvidenceGrid({ results }: { results: SourceResultView[] }) {
  if (results.length === 0) {
    return (
      <Card className="border-dashed p-10 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground">
          <Database className="h-5 w-5" />
        </span>
        <p className="mt-4 font-display text-[14px] font-semibold">
          Evidence will appear here
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
          Each queried source returns its status, query, latency, and raw data.
          One failed source never hides the others.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {results.map((result) => (
        <Card
          key={result.sourceId}
          className="flex flex-col overflow-hidden"
        >
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/80 bg-muted/60 text-foreground/70">
                <SourceIcon
                  type={result.integrationType}
                  category={result.category}
                />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">
                  {sourceDisplayName({
                    id: result.sourceId,
                    name: result.sourceName,
                  })}
                </p>
                <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  {result.category} · {result.integrationType}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Badge variant={STATUS_VARIANT[result.status]} className="capitalize">
                {result.status}
              </Badge>
              {typeof result.durationMs === "number" ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {result.durationMs}ms
                </span>
              ) : null}
            </div>
          </div>

          {result.query ? (
            <div className="border-t border-border/70 bg-muted/25 px-4 py-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                <Terminal className="h-3 w-3" />
                Query
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/85">
                {result.query}
              </pre>
            </div>
          ) : null}

          {result.error ? (
            <div className="border-t border-destructive/20 bg-destructive/5 px-4 py-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Error
              </p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-destructive">
                {result.error}
              </pre>
            </div>
          ) : null}

          <details className="group mt-auto border-t border-border/70">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-1.5">
                <FileText className="h-3 w-3" />
                Raw data
              </span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-3">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-background/60 p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                {formatEvidence(result.data)}
              </pre>
            </div>
          </details>
        </Card>
      ))}
    </div>
  );
}
