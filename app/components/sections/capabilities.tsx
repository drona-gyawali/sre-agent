import { Database, FileCheck2, Fingerprint, Waypoints } from "lucide-react";
import { GithubIcon } from "@/app/components/icons";
import { Card } from "@/app/components/ui/card";
import { SectionHeading } from "@/app/components/section-heading";

const FEATURES = [
  {
    icon: GithubIcon,
    title: "Issue-aware context",
    description:
      "Pulls the live GitHub issue, then extracts the customer, transaction, service, and error identifiers buried in the report.",
    tag: "GitHub MCP",
  },
  {
    icon: Database,
    title: "Multi-source evidence",
    description:
      "Queries the application database, log store, PostgreSQL, and Prometheus in parallel through a shared adapter layer.",
    tag: "Adapters",
  },
  {
    icon: Waypoints,
    title: "LLM-planned investigation",
    description:
      "A planner selects only the sources that matter, then generates read-only SQL and PromQL for each one.",
    tag: "LangGraph",
  },
  {
    icon: FileCheck2,
    title: "Evidence-backed reports",
    description:
      "Every conclusion names its source, query, duration, and raw result — so you can verify the answer instead of trusting it.",
    tag: "Traceable",
  },
] as const;

export function Capabilities() {
  return (
    <section
      id="capabilities"
      className="scroll-mt-20 border-b border-border/60 py-20 lg:py-24"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="Capabilities"
            title={
              <>
                Everything you need to go from{" "}
                <span className="text-primary">alert</span> to answer.
              </>
            }
            description="One workspace that reads the incident, gathers evidence from every relevant system, and explains what actually happened."
          />
          <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground lg:pb-2 lg:text-right">
            Built on a configuration-driven adapter architecture. Add a source
            without rewiring the workflow.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, description, tag }) => (
            <Card
              key={title}
              className="group relative overflow-hidden p-6 transition-colors hover:border-primary/35 hover:bg-card"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-primary/[0.06] blur-2xl transition-opacity group-hover:opacity-100"
              />
              <div className="relative grid h-10 w-10 place-items-center rounded-xl border border-border bg-muted/60 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="relative mt-5 font-display text-[15px] font-semibold tracking-tight">
                {title}
              </h3>
              <p className="relative mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {description}
              </p>
              <p className="relative mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                {tag}
              </p>
            </Card>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 text-[12px] text-muted-foreground">
          <Fingerprint className="h-4 w-4 shrink-0 text-primary" />
          Every run keeps the evidence attached — source, query, latency, and raw
          data — so reports can be audited later.
        </div>
      </div>
    </section>
  );
}
