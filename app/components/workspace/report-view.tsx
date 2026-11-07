"use client";

import { useState } from "react";
import { Check, Copy, FileText } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";

export function ReportView({ report }: { report: string }) {
  const [copied, setCopied] = useState(false);

  async function copyReport() {
    if (!report) return;

    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (!report) {
    return (
      <Card className="border-dashed p-10 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground">
          <FileText className="h-5 w-5" />
        </span>
        <p className="mt-4 font-display text-[14px] font-semibold">
          The report lands here
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
          After the sources are investigated, the agent synthesizes the evidence
          into a summary, root cause, recommended fix, and confidence level.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[13px] font-semibold">Diagnostic report</p>
            <p className="text-[11px] text-muted-foreground">
              Evidence-backed incident summary
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="muted" className="font-mono">
            markdown
          </Badge>
          <Button variant="outline" size="sm" onClick={copyReport}>
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      <div className="report-prose max-h-[68vh] overflow-auto p-5 sm:p-6">
        <Markdown remarkPlugins={[remarkGfm]}>{report}</Markdown>
      </div>
    </Card>
  );
}
