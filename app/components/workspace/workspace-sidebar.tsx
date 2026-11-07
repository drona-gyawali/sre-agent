"use client";

import {
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useHealth } from "@/app/components/health-provider";
import { sourceDisplayName } from "@/app/components/source-icon";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { cn } from "@/app/lib/cn";

const COUNT_META = [
  { key: "up", label: "Up", className: "text-success" },
  { key: "down", label: "Down", className: "text-destructive" },
  { key: "disabled", label: "Off", className: "text-muted-foreground" },
] as const;

export function SourceHealthPanel() {
  const { health, loading, reload, upCount, downCount, disabledCount } =
    useHealth();

  const counts = {
    up: upCount,
    down: downCount,
    disabled: disabledCount,
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div>
          <p className="text-[12px] font-semibold">Source health</p>
          <p className="text-[10px] text-muted-foreground">
            Configured adapters
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={reload}
          disabled={loading}
          aria-label="Refresh source health"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-3 gap-1.5">
          {COUNT_META.map(({ key, label, className }) => (
            <div
              key={key}
              className="rounded-lg border border-border/70 bg-background/50 px-2 py-1.5"
            >
              <p className={cn("font-display text-base font-semibold", className)}>
                {counts[key]}
              </p>
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-2.5 space-y-0.5">
          {loading && !health
            ? Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-2 py-2"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                  <span className="h-2.5 w-24 animate-pulse rounded bg-muted" />
                </div>
              ))
            : health?.sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      source.status === "up" && "bg-success",
                      source.status === "down" && "bg-destructive",
                      source.status === "disabled" && "bg-muted-foreground/50"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px]">
                    {sourceDisplayName(source)}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                    {source.status === "up"
                      ? `${source.latencyMs}ms`
                      : source.status}
                  </span>
                </div>
              ))}
        </div>

        <p className="mt-2.5 border-t border-border/60 pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          Health checks do not invoke the model.
        </p>
      </div>
    </Card>
  );
}

export function ModelCard({
  model,
  onChange,
  disabled,
}: {
  model: string;
  onChange: (model: string) => void;
  disabled: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        <div>
          <p className="text-[12px] font-semibold">Model</p>
          <p className="text-[10px] text-muted-foreground">
            Planning and report synthesis
          </p>
        </div>
      </div>
      <div className="p-3">
        <select
          value={model}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label="Diagnostic model"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[12px] shadow-sm transition-colors focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60"
        >
          <option value="google:gemini-3.5-flash-lite">
            Gemini 3.5 Flash Lite
          </option>
        </select>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Providers are registered in{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[9px]">
            model.registry.ts
          </code>
        </p>
      </div>
    </Card>
  );
}

export function SafetyNote() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-3.5">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-[11px] font-semibold">Read-only by design</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            The agent generates SELECT and PromQL queries only. Secrets are
            never written to logs or reports.
          </p>
        </div>
      </div>
    </div>
  );
}
