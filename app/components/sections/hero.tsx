import {
  ArrowDown,
  Check,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  Plug,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { StartButton } from "@/app/components/start-button";
import { GithubIcon } from "@/app/components/icons";
import { cn } from "@/app/lib/cn";

const MOCK_STEPS = [
  {
    label: "Fetched GitHub issue",
    meta: "142 ms",
    state: "done",
  },
  {
    label: "Extracted 4 identifiers",
    meta: "customer · C-1001",
    state: "done",
  },
  {
    label: "Queried 4 data sources",
    meta: "2.1 s",
    state: "done",
  },
  {
    label: "Drafted root-cause report",
    meta: "High confidence",
    state: "active",
  },
] as const;

const MOCK_SOURCES = [
  { name: "GitHub", meta: "issue #4821" },
  { name: "Postgres", meta: "412 ms" },
  { name: "Prometheus", meta: "233 ms" },
] as const;

const PROOF_POINTS = [
  { icon: ShieldCheck, label: "Read-only SQL & PromQL" },
  { icon: LockKeyhole, label: "No secrets logged" },
  { icon: Fingerprint, label: "Every finding cited" },
] as const;

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-grid opacity-60 mask-fade-b"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-24rem] h-[48rem] w-[74rem] -translate-x-1/2 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 22%, transparent), transparent)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 top-24 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--warning) 9%, transparent), transparent)",
        }}
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10 lg:px-8 lg:pb-28 lg:pt-24">
        <div className="min-w-0 max-w-xl">
          <Badge
            variant="outline"
            className="mb-6 gap-2 border-border/80 bg-card/70 py-1 pl-2 pr-3 text-muted-foreground backdrop-blur"
          >
            <span className="relative grid h-4 w-4 place-items-center">
              <span className="absolute h-4 w-4 rounded-full bg-primary/20 animate-pulse-ring" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Incident intelligence, backed by evidence
          </Badge>

          <h1 className="font-display text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-6xl">
            Diagnose production incidents with{" "}
            <span className="relative whitespace-nowrap text-primary">
              evidence
              <svg
                aria-hidden="true"
                viewBox="0 0 240 9"
                preserveAspectRatio="none"
                className="absolute -bottom-1 left-0 h-2 w-full text-primary/35"
              >
                <path
                  d="M1 6.5c48-4 92-5.5 140-4.2 34 .9 64 2.4 98 4.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            , not guesswork.
          </h1>

          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            SRE Agent reads the incident, extracts the entities that matter, and
            queries your databases, logs, and metrics through read-only MCP
            adapters — then writes a root-cause report with the exact evidence it
            used.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <StartButton label="Start a diagnosis" />
            <Button asChild variant="outline" size="lg" className="group">
              <a href="#workflow">
                See how it works
                <ArrowDown className="transition-transform duration-200 group-hover:translate-y-0.5" />
              </a>
            </Button>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
            {PROOF_POINTS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"
              >
                <Icon className="h-3.5 w-3.5 text-primary" />
                {label}
              </li>
            ))}
          </ul>

          <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-border/70 pt-6 sm:gap-6">
            {[
              { value: "5", label: "integrations" },
              { value: "4", label: "workflow stages" },
              { value: "1", label: "evidence report" },
            ].map((stat) => (
              <div key={stat.label} className="min-w-0">
                <dt className="font-display text-2xl font-semibold tracking-tight">
                  {stat.value}
                </dt>
                <dd className="mt-1 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                  {stat.label}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}

function MockSourceIcon({ name }: { name: string }) {
  if (name === "GitHub") {
    return <GithubIcon className="h-3 w-3" />;
  }
  if (name === "Prometheus") {
    return <Zap className="h-3 w-3" />;
  }
  return <Plug className="h-3 w-3" />;
}

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full min-w-0 max-w-[560px] lg:mx-0">
      <div
        aria-hidden="true"
        className="absolute -inset-6 rounded-[2.5rem] blur-2xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 14%, transparent), transparent)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-2xl shadow-black/10 backdrop-blur">
        <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/40 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-destructive/60" />
            <span className="h-2 w-2 rounded-full bg-warning/60" />
            <span className="h-2 w-2 rounded-full bg-success/60" />
          </div>
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            investigation / live session
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            read-only
          </span>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Incident #4821
              </p>
              <p className="mt-1 truncate font-display text-sm font-semibold">
                payment-api · checkout failures
              </p>
            </div>
            <Badge variant="success" className="shrink-0">
              <Check className="h-3 w-3" />
              Root cause found
            </Badge>
          </div>

          <div className="space-y-1.5">
            {MOCK_STEPS.map((step) => (
              <div
                key={step.label}
                className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/60 px-3 py-2"
              >
                <span
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full",
                    step.state === "done"
                      ? "bg-success/12 text-success"
                      : "bg-primary/12 text-primary"
                  )}
                >
                  {step.state === "done" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  )}
                </span>
                <span className="truncate text-[11px] font-medium">
                  {step.label}
                </span>
                <span className="ml-auto hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:block">
                  {step.meta}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-primary/25 bg-primary/[0.07] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                Root cause
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                confidence: high
              </span>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-foreground/90">
              Missing composite index on{" "}
              <code className="rounded border border-border bg-background/70 px-1 py-0.5 font-mono text-[10px]">
                orders(customer_id, created_at)
              </code>{" "}
              forced sequential scans under checkout load, pushing p95 latency
              past the 2s timeout.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["2 queries cited", "3 log matches", "p95 +840ms"].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border/80 bg-background/60 px-2 py-0.5 font-mono text-[9px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {MOCK_SOURCES.map((source) => (
              <div
                key={source.name}
                className="rounded-lg border border-border/70 bg-background/60 px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5 text-[10px] font-medium">
                  <span className="text-primary">
                    <MockSourceIcon name={source.name} />
                  </span>
                  <span className="truncate">{source.name}</span>
                </div>
                <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                  {source.meta}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute -right-4 bottom-24 hidden items-center gap-2 rounded-xl border border-border/80 bg-card/95 px-3 py-2 shadow-lg backdrop-blur xl:flex">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-success/12 text-success">
          <ShieldCheck className="h-3.5 w-3.5" />
        </span>
        <div>
          <p className="text-[10px] font-semibold">Read-only by design</p>
          <p className="font-mono text-[9px] text-muted-foreground">
            SELECT · PromQL only
          </p>
        </div>
      </div>
    </div>
  );
}
