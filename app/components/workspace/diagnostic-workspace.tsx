"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { HealthPill } from "@/app/components/health-badge";
import { useHealth } from "@/app/components/health-provider";
import { SectionHeading } from "@/app/components/section-heading";
import { useDiagnosis, parseSourceResults } from "@/app/components/use-diagnosis";
import { EvidenceGrid } from "@/app/components/workspace/evidence-grid";
import { IncidentForm } from "@/app/components/workspace/incident-form";
import { ReportView } from "@/app/components/workspace/report-view";
import { StepTimeline } from "@/app/components/workspace/step-timeline";
import {
  ModelCard,
  SafetyNote,
  SourceHealthPanel,
} from "@/app/components/workspace/workspace-sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { cn } from "@/app/lib/cn";

const DEFAULT_MODEL = "google:gemini-3.5-flash-lite";

export function DiagnosticWorkspace() {
  const { steps, report, running, error, run, stop } = useDiagnosis();
  const { health, loading, error: healthError, upCount, downCount } = useHealth();
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [activeTab, setActiveTab] = useState("timeline");
  const lastReport = useRef("");

  const sourceResults = parseSourceResults(steps);
  const stageCount = new Set(
    steps
      .filter((step) => step.node !== "done" && step.node !== "error")
      .map((step) => step.node)
  ).size;

  useEffect(() => {
    if (report && report !== lastReport.current) {
      lastReport.current = report;
      setActiveTab("report");
    }
  }, [report]);

  function handleRun(message: string) {
    setActiveTab("timeline");
    void run(message, model);
  }

  const statusLabel = running
    ? "streaming"
    : report
      ? "complete"
      : steps.length > 0
        ? "stopped"
        : "idle";

  return (
    <section
      id="workspace"
      className="relative scroll-mt-20 overflow-hidden py-20 lg:py-24"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-dots opacity-[0.35] mask-fade-b"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[28rem] w-[60rem] -translate-x-1/2 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 10%, transparent), transparent)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="Workspace"
            title="Run a live investigation."
            description="Paste the incident, choose a model, and watch the agent work. Every stage, query, and source result stays visible while the report is assembled."
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <HealthPill
              status={health?.status}
              upCount={upCount}
              downCount={downCount}
              loading={loading}
              error={healthError}
            />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/60 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  running
                    ? "bg-primary animate-pulse"
                    : report
                      ? "bg-success"
                      : "bg-muted-foreground/60"
                )}
              />
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          <aside className="space-y-3 lg:sticky lg:top-20">
            <SourceHealthPanel />
            <ModelCard model={model} onChange={setModel} disabled={running} />
            <SafetyNote />
          </aside>

          <div className="min-w-0 space-y-4">
            <IncidentForm running={running} onRun={handleRun} onStop={stop} />

            {error ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-[13px] font-semibold text-destructive">
                    Investigation stopped
                  </p>
                  <p className="mt-0.5 break-words text-[12px] leading-relaxed text-muted-foreground">
                    {error}
                  </p>
                </div>
              </div>
            ) : null}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="timeline">
                    Timeline
                    {stageCount > 0 ? (
                      <span className="rounded-full bg-background/70 px-1.5 py-0.5 font-mono text-[9px]">
                        {stageCount}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="evidence">
                    Evidence
                    {sourceResults.length > 0 ? (
                      <span className="rounded-full bg-background/70 px-1.5 py-0.5 font-mono text-[9px]">
                        {sourceResults.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="report">
                    Report
                    {report ? <Check className="h-3 w-3 text-success" /> : null}
                  </TabsTrigger>
                </TabsList>

                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {running
                    ? "streaming events"
                    : report
                      ? "report ready"
                      : "awaiting incident"}
                </p>
              </div>

              <TabsContent value="timeline">
                <StepTimeline steps={steps} running={running} />
              </TabsContent>
              <TabsContent value="evidence">
                <EvidenceGrid results={sourceResults} />
              </TabsContent>
              <TabsContent value="report">
                <ReportView report={report} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </section>
  );
}
