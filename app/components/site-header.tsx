"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { HealthPill } from "@/app/components/health-badge";
import { Logo } from "@/app/components/logo";
import { StartButton } from "@/app/components/start-button";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { Button } from "@/app/components/ui/button";
import { useHealth } from "@/app/components/health-provider";
import { cn } from "@/app/lib/cn";

const NAV_LINKS = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#workflow", label: "Workflow" },
  { href: "#status", label: "Sources" },
  { href: "#workspace", label: "Workspace" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { health, loading, error, upCount, downCount } = useHealth();

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <a href="#top" className="flex shrink-0 items-center gap-2.5">
          <Logo />
          <span className="flex flex-col leading-none whitespace-nowrap">
            <span className="font-display text-[15px] font-semibold tracking-tight">
              SRE Agent
            </span>
            <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Diagnostic workspace
            </span>
          </span>
        </a>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <HealthPill
            status={health?.status}
            upCount={upCount}
            downCount={downCount}
            loading={loading}
            error={error}
            className="hidden lg:inline-flex"
          />
          <ThemeToggle />
          <StartButton
            size="sm"
            label="Start diagnosis"
            className="hidden sm:inline-flex"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "overflow-hidden border-border/70 lg:hidden",
          open ? "border-t" : "max-h-0"
        )}
      >
        <nav
          className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6"
          aria-label="Mobile"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <div className="mt-2 px-1">
            <StartButton size="sm" className="w-full" />
          </div>
        </nav>
      </div>
    </header>
  );
}
