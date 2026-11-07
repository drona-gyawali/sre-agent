import { FileCheck2, Fingerprint, Waypoints } from "lucide-react";
import { GithubIcon } from "@/app/components/icons";
import { Badge } from "@/app/components/ui/badge";
import { SectionHeading } from "@/app/components/section-heading";

const STAGES = [
  {
    number: "01",
    title: "Fetch the issue",
    description:
      "Pull the issue body, labels, and repository context through GitHub MCP.",
    tag: "GitHub MCP",
    icon: GithubIcon,
  },
  {
    number: "02",
    title: "Extract identifiers",
    description:
      "Find the customer, transaction, service, and error codes hidden in the report.",
    tag: "Gemini",
    icon: Fingerprint,
  },
  {
    number: "03",
    title: "Investigate sources",
    description:
      "Plan the relevant sources, then run read-only SQL and PromQL in parallel.",
    tag: "MCP adapters",
    icon: Waypoints,
  },
  {
    number: "04",
    title: "Write the report",
    description:
      "Tie every conclusion to a source, query, and raw result. No speculation.",
    tag: "Evidence synthesis",
    icon: FileCheck2,
  },
] as const;

const REPORT_SECTIONS = [
  "Summary",
  "Root cause",
  "Evidence",
  "Recommended fix",
  "Confidence",
];

export function Workflow() {
  return (
    <section
      id="workflow"
      className="scroll-mt-20 border-b border-border/60 bg-muted/25 py-20 lg:py-24"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          align="center"
          eyebrow="How it works"
          title={
            <>
              Four stages. One{" "}
              <span className="text-primary">defensible</span> answer.
            </>
          }
          description="The workflow stays the same for every incident. The planner decides which sources are worth querying, and the report only includes what the sources actually returned."
        />

        <div className="relative mt-14">
          <div
            aria-hidden="true"
            className="absolute left-[7%] right-[7%] top-5 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent lg:block"
          />

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {STAGES.map(({ number, title, description, tag, icon: Icon }) => (
              <div key={number} className="group relative">
                <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm transition-colors group-hover:border-primary/40 group-hover:bg-primary/5">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <span className="font-mono text-[10px] font-semibold text-primary">
                    {number}
                  </span>
                  <span className="h-px w-5 bg-border" />
                  <Badge variant="muted">{tag}</Badge>
                </div>
                <h3 className="mt-3 font-display text-[15px] font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <FileCheck2 className="h-4 w-4 text-primary" />
              Every report ships with these sections
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              markdown · exportable
            </span>
          </div>
          <div className="flex flex-wrap gap-2 p-5">
            {REPORT_SECTIONS.map((section, index) => (
              <span
                key={section}
                className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-background/60 px-3 py-1.5 text-[12px] font-medium"
              >
                <span className="font-mono text-[10px] text-primary">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {section}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
