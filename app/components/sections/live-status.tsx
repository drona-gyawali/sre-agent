"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useHealth } from "@/app/components/health-provider";
import { HealthPill, HealthStatusBadge } from "@/app/components/health-badge";
import { SourceIcon, sourceDisplayName } from "@/app/components/source-icon";
import { SectionHeading } from "@/app/components/section-heading";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { cn } from "@/app/lib/cn";

export function LiveStatus() {
  const {
    health,
    loading,
    error,
    reload,
    upCount,
    downCount,
    disabledCount,
    enabledCount,
  } = useHealth();

  const checkedAt = health?.checkedAt
    ? new Date(health.checkedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <section
      id="status"
      className="scroll-mt-20 border-b border-border/60 py-20 lg:py-24"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="Live status"
            title="Know what's connected before you investigate."
            description="Health checks hit each configured adapter directly. Disabled sources stay visible so you always know what the agent can and cannot see."
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <HealthPill
              status={health?.status}
              upCount={upCount}
              downCount={downCount}
              loading={loading}
              error={error}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={reload}
              disabled={loading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {loading && !health
            ? Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
                      <div className="space-y-1.5">
                        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                        <div className="h-2 w-24 animate-pulse rounded bg-muted" />
                      </div>
                    </div>
                    <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
                  </div>
                  <div className="mt-4 h-3 w-full animate-pulse rounded bg-muted" />
                </Card>
              ))
            : null}

          {!loading && error && !health ? (
            <Card className="col-span-full flex items-start gap-3 border-destructive/30 bg-destructive/5 p-5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-[13px] font-semibold text-destructive">
                  Could not reach the health endpoint
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">{error}</p>
              </div>
            </Card>
          ) : null}

          {health?.sources.map((source) => (
            <Card
              key={source.id}
              className="group p-4 transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/80 bg-muted/60 text-foreground/70">
                    <SourceIcon
                      type={source.type}
                      category={source.category}
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">
                      {sourceDisplayName(source)}
                    </p>
                    <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                      {source.category} · {source.type}
                    </p>
                  </div>
                </div>
                <HealthStatusBadge status={source.status} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                <p
                  className="truncate text-[11px] text-muted-foreground"
                  title={source.detail}
                >
                  {source.status === "disabled"
                    ? "Enable in .env to include"
                    : source.detail}
                </p>
                {source.status === "up" && source.latencyMs > 0 ? (
                  <span className="shrink-0 font-mono text-[10px] text-success">
                    {source.latencyMs}ms
                  </span>
                ) : null}
              </div>
            </Card>
          ))}

          {!loading && health && health.sources.length === 0 ? (
            <Card className="col-span-full border-dashed p-8 text-center text-[13px] text-muted-foreground">
              No datasources are configured yet.
            </Card>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{enabledCount}</span>{" "}
            enabled
          </span>
          <span className="h-3 w-px bg-border" />
          <span>
            <span className="font-semibold text-success">{upCount}</span> up
          </span>
          <span className="h-3 w-px bg-border" />
          <span>
            <span className="font-semibold text-destructive">{downCount}</span>{" "}
            down
          </span>
          <span className="h-3 w-px bg-border" />
          <span>
            <span className="font-semibold text-foreground">
              {disabledCount}
            </span>{" "}
            disabled
          </span>
          {checkedAt ? (
            <>
              <span className="h-3 w-px bg-border" />
              <span className="font-mono">checked {checkedAt}</span>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
