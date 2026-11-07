"use client";

import { useState } from "react";
import { LoaderCircle, Play, Square } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Textarea } from "@/app/components/ui/textarea";

const EXAMPLES = [
  {
    label: "Payment failure",
    text: "issue #1 in myorg/myrepo is causing payment failures for customer C-1001",
  },
  {
    label: "Checkout latency",
    text: "issue #12 in acme/checkout reports elevated latency; service=checkout-api errorCode=ECONNRESET",
  },
] as const;

const MIN_LENGTH = 12;

export function IncidentForm({
  running,
  onRun,
  onStop,
}: {
  running: boolean;
  onRun: (message: string) => void;
  onStop: () => void;
}) {
  const [message, setMessage] = useState("");

  const canRun = message.trim().length >= MIN_LENGTH && !running;

  function submit() {
    if (canRun) onRun(message);
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-[15px] font-semibold tracking-tight">
            Incident
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Include the repository, issue number, customer, or error code.
          </p>
        </div>
        <div className="mt-2 flex items-center gap-2 sm:mt-0">
          <Badge variant="muted" className="font-mono">
            POST /api/diagnose
          </Badge>
          <span className="text-[10px] text-muted-foreground">SSE</span>
        </div>
      </div>

      <div className="p-5">
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Try
          </span>
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              disabled={running}
              onClick={() => setMessage(example.text)}
              className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              {example.label}
            </button>
          ))}
        </div>

        <Textarea
          id="incident-input"
          rows={5}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          disabled={running}
          placeholder="e.g. issue #1 in myorg/myrepo is causing payment failures for customer C-1001"
          aria-label="Incident description"
        />

        <div className="mt-3 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-[11px] text-muted-foreground">
            {running ? (
              <span className="inline-flex items-center gap-1.5 text-primary">
                <LoaderCircle className="h-3 w-3 animate-spin" />
                Investigation running — evidence streams in as it completes.
              </span>
            ) : (
              <>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  ⌘
                </kbd>{" "}
                +{" "}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  Enter
                </kbd>{" "}
                to run
              </>
            )}
          </p>

          <div className="flex items-center gap-2">
            {running ? (
              <Button variant="outline" onClick={onStop}>
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : null}
            <Button onClick={submit} disabled={!canRun} className="group">
              {running ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
              )}
              {running ? "Running" : "Run diagnosis"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
