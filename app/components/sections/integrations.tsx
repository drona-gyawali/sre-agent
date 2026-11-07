import { Activity, Database, Plug } from "lucide-react";
import { GithubIcon } from "@/app/components/icons";

const INTEGRATIONS = [
  { name: "GitHub", icon: GithubIcon },
  { name: "SQLite", icon: Database },
  { name: "PostgreSQL", icon: Database },
  { name: "Prometheus", icon: Activity },
  { name: "MCP", icon: Plug },
] as const;

export function Integrations() {
  return (
    <section
      id="integrations"
      aria-label="Supported integrations"
      className="border-y border-border/60 bg-muted/30"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-5 px-4 py-5 sm:px-6 md:flex-row md:items-center lg:px-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Connects with your stack
        </p>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          {INTEGRATIONS.map(({ name, icon: Icon }) => (
            <span
              key={name}
              className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground"
            >
              <span className="grid h-6 w-6 place-items-center rounded-md border border-border/70 bg-card/60 text-foreground/70">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
