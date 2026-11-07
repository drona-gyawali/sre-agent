import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/app/components/logo";

const EXPLORE = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#workflow", label: "Workflow" },
  { href: "#status", label: "Live status" },
  { href: "#workspace", label: "Workspace" },
];

const STACK = ["Next.js", "LangGraph", "MCP", "Gemini"];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-muted/25">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo />
              <span className="font-display text-[15px] font-semibold tracking-tight">
                SRE Agent
              </span>
            </div>
            <p className="mt-3 max-w-xs text-[12px] leading-relaxed text-muted-foreground">
              An evidence-backed diagnostic agent for production incidents.
              Reads the issue, queries your sources, and writes the report.
            </p>
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/60 px-2.5 py-1 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Read-only queries · no secrets logged
            </p>
          </div>

          <FooterColumn title="Explore" links={EXPLORE} />

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Endpoints
            </p>
            <ul className="mt-4 space-y-2.5 text-[12px]">
              <li>
                <a
                  href="/api/health"
                  className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="font-mono text-[10px] text-primary">GET</span>
                  /api/health
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
              <li className="text-muted-foreground">
                <span className="mr-1.5 font-mono text-[10px] text-primary">
                  POST
                </span>
                /api/diagnose
              </li>
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Built with
            </p>
            <ul className="mt-4 space-y-2.5 text-[12px] text-muted-foreground">
              {STACK.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border/60 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            © SRE Agent. Evidence stays in your environment.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Incident intelligence · v1
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ href: string; label: string }>;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <ul className="mt-4 space-y-2.5 text-[12px]">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
