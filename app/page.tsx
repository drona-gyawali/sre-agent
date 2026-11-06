"use client";

import { useEffect, useState } from "react";

type HealthStatus = "up" | "down" | "disabled";

interface SourceHealth {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly category: string;
  readonly enabled: boolean;
  readonly status: HealthStatus;
  readonly latencyMs: number;
  readonly detail: string;
}

interface HealthResponse {
  readonly status: "ok" | "degraded" | "down";
  readonly checkedAt: string;
  readonly sources: SourceHealth[];
}

interface SourceResultView {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly integrationType: string;
  readonly category: string;
  readonly status: "success" | "partial" | "failed";
  readonly data: unknown;
  readonly query?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

type Step = { node: string; update: Record<string, unknown> };

const NODE_LABELS: Record<string, string> = {
  fetch_issue: "Fetch issue",
  extract_identifiers: "Extract identifiers",
  investigate_sources: "Investigate sources",
  generate_report: "Generate report",
  done: "Done",
};

const NODE_DESCRIPTIONS: Record<string, string> = {
  fetch_issue: "Loading issue context and repository metadata.",
  extract_identifiers: "Finding customer, transaction, and error identifiers.",
  investigate_sources: "Planning and querying enabled investigation sources.",
  generate_report: "Synthesizing evidence into a diagnostic report.",
  done: "Investigation completed.",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "No data returned.";
  if (typeof value === "string") return value || "No data returned.";
  return JSON.stringify(value, null, 2);
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function ActivityIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function PlayIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function CheckIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function AlertIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  );
}

function RefreshIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  );
}

function CopyIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ShieldIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function DatabaseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: HealthStatus }) {
  const cfg: Record<HealthStatus, { dot: string; label: string; text: string }> = {
    up:       { dot: "bg-emerald-400",  label: "bg-emerald-400/10 ring-emerald-400/20 text-emerald-300", text: "Up" },
    down:     { dot: "bg-red-400",     label: "bg-red-400/10 ring-red-400/20 text-red-300",             text: "Down" },
    disabled: { dot: "bg-zinc-500",    label: "bg-zinc-500/10 ring-zinc-500/20 text-zinc-400",          text: "Disabled" },
  };
  const c = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${c.label}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.text}
    </span>
  );
}

function SourceStatusPill({ status }: { status: SourceResultView["status"] }) {
  const cfg = {
    success: "bg-emerald-400/10 ring-emerald-400/20 text-emerald-300",
    partial:  "bg-amber-400/10 ring-amber-400/20 text-amber-300",
    failed:   "bg-red-400/10 ring-red-400/20 text-red-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${cfg[status]}`}>
      {status}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DiagnosePage() {
  const [message, setMessage] = useState("");
  const [model, setModel] = useState("google:gemini-3.5-flash-lite");
  const [steps, setSteps] = useState<Step[]>([]);
  const [report, setReport] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "sources" | "report">("timeline");

  async function loadHealth() {
    setLoadingHealth(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`Health endpoint returned ${res.status}`);
      setHealth((await res.json()) as HealthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingHealth(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoadingHealth(true);
    fetch("/api/health", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<HealthResponse>; })
      .then((b) => { if (!cancelled) setHealth(b); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingHealth(false); });
    return () => { cancelled = true; };
  }, []);

  function handlePayload(payload: Step) {
    if (payload.node === "error") {
      setError(typeof payload.update.error === "string" ? payload.update.error : String(payload.update.error));
      return;
    }
    setSteps((prev) => [...prev, payload]);
    if (payload.node === "generate_report" && typeof payload.update.report === "string") {
      setReport(payload.update.report);
      setActiveTab("report");
    }
  }

  async function run() {
    if (!message.trim() || running) return;
    setSteps([]); setReport(""); setError(""); setCopied(false);
    setRunning(true); setActiveTab("timeline");
    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model }),
      });
      if (!res.body) throw new Error("Empty stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n");
        while (idx >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line.startsWith("data:")) handlePayload(JSON.parse(line.slice(5).trim()) as Step);
          idx = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail.startsWith("data:")) handlePayload(JSON.parse(tail.slice(5).trim()) as Step);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function copyReport() {
    if (!report) return;
    await navigator.clipboard.writeText(report);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const sourceResults = [...steps].reverse()
    .find((s) => s.update.sourceResults && typeof s.update.sourceResults === "object")
    ?.update.sourceResults as Record<string, SourceResultView> | undefined;
  const sourceList = sourceResults ? Object.values(sourceResults) : [];
  const completedSteps = steps.filter((s) => s.node !== "done");

  const upCount = health?.sources.filter((s) => s.status === "up").length ?? 0;
  const downCount = health?.sources.filter((s) => s.status === "down").length ?? 0;
  const disabledCount = health?.sources.filter((s) => s.status === "disabled").length ?? 0;
  const overallOk = health?.status === "ok";

  const tabs = [
    { id: "timeline" as const, label: "Timeline", badge: completedSteps.length || null },
    { id: "sources"  as const, label: "Evidence",  badge: sourceList.length || null },
    { id: "report"   as const, label: "Report",    badge: report ? "✓" : null },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg:        #090B0F;
          --surface:   #0F1117;
          --surface2:  #141720;
          --border:    rgba(255,255,255,0.07);
          --border2:   rgba(255,255,255,0.12);
          --indigo:    #6366F1;
          --indigo-dim:#6366F120;
          --text:      #E8EAF0;
          --muted:     #6B7280;
          --muted2:    #9CA3AF;
          --emerald:   #10B981;
          --red:       #EF4444;
          --amber:     #F59E0B;
          --cyan:      #06B6D4;
          font-family: 'Inter', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
          color-scheme: dark;
        }
        body { background: var(--bg); color: var(--text); }
        ::selection { background: #6366F140; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ffffff18; border-radius: 4px; }
        textarea:focus, select:focus, button:focus-visible {
          outline: 2px solid var(--indigo);
          outline-offset: 2px;
        }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .pulse-dot { animation: pulse-dot 1.4s ease-in-out infinite; }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.75); }
        }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .fadeIn { animation: fadeIn 0.18s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

        {/* Top bar */}
        <header style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          padding: "0 1.5rem",
          height: "56px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 50,
          backdropFilter: "blur(12px)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "var(--indigo)", display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#fff", flexShrink: 0,
            }}>
              <ActivityIcon className="h-4 w-4" />
            </div>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>
                SRE Diagnostic
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
                Incident workspace
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Health indicator */}
            {health && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: 20,
                border: "1px solid var(--border2)",
                background: overallOk ? "#10B98112" : "#EF444412",
                fontSize: 12, fontWeight: 500,
                color: overallOk ? "var(--emerald)" : "var(--red)",
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: overallOk ? "var(--emerald)" : "var(--red)", display: "inline-block" }} />
                {upCount} sources up{downCount > 0 ? ` · ${downCount} down` : ""}
              </div>
            )}
            <button
              type="button"
              onClick={loadHealth}
              disabled={loadingHealth}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 8,
                border: "1px solid var(--border2)",
                background: "var(--surface2)",
                color: "var(--muted2)", fontSize: 12, fontWeight: 500,
                cursor: loadingHealth ? "not-allowed" : "pointer",
                opacity: loadingHealth ? 0.6 : 1, transition: "background 0.15s",
              }}
            >
              <RefreshIcon className={loadingHealth ? "h-3.5 w-3.5 spin" : "h-3.5 w-3.5"} />
              Refresh
            </button>
          </div>
        </header>

        {/* Main layout */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "340px 1fr", maxWidth: 1400, margin: "0 auto", width: "100%", gap: 0 }}>

          {/* ── Left sidebar: health ── */}
          <aside style={{
            borderRight: "1px solid var(--border)",
            padding: "1.25rem",
            overflowY: "auto",
            maxHeight: "calc(100vh - 56px)",
            position: "sticky",
            top: "56px",
          }}>

            {/* Summary row */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
                Source health
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {[
                  { label: "Up",       val: upCount,       color: "var(--emerald)", bg: "#10B98110" },
                  { label: "Down",     val: downCount,     color: "var(--red)",     bg: "#EF444410" },
                  { label: "Disabled", val: disabledCount, color: "var(--muted)",   bg: "var(--surface2)" },
                ].map(({ label, val, color, bg }) => (
                  <div key={label} style={{
                    background: bg, borderRadius: 8, padding: "8px 10px",
                    border: "1px solid var(--border)",
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Source list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loadingHealth && !health && (
                <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  Loading sources…
                </div>
              )}
              {health?.sources.length === 0 && (
                <div style={{
                  padding: "24px 12px", textAlign: "center", border: "1px dashed var(--border)",
                  borderRadius: 10, color: "var(--muted)", fontSize: 13,
                }}>
                  <DatabaseIcon className="h-5 w-5" />
                  <div style={{ marginTop: 8 }}>No datasources configured</div>
                </div>
              )}
              {health?.sources.map((src) => (
                <div key={src.id} className="fadeIn" style={{
                  background: "var(--surface2)", borderRadius: 10,
                  border: "1px solid var(--border)",
                  padding: "10px 12px",
                  borderLeft: `2px solid ${src.status === "up" ? "var(--emerald)" : src.status === "down" ? "var(--red)" : "var(--muted)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {src.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {src.category} · {src.type}
                      </div>
                    </div>
                    <StatusDot status={src.status} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>{src.detail}</div>
                  {src.enabled && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }} className="mono">
                      {src.latencyMs}ms
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Divider */}
            <div style={{ borderTop: "1px solid var(--border)", margin: "1.25rem 0" }} />

            {/* Model select */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={running}
                style={{
                  width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
                  borderRadius: 8, padding: "8px 10px", fontSize: 13,
                  color: "var(--text)", cursor: "pointer",
                }}
              >
                <option value="google:gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</option>
              </select>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", margin: "1.25rem 0" }} />

            {/* Footer note */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 11 }}>
              <ShieldIcon className="h-3.5 w-3.5" />
              No secrets are logged
            </div>
          </aside>

          {/* ── Main content ── */}
          <main style={{ display: "flex", flexDirection: "column", padding: "1.25rem 1.5rem", overflowY: "auto", maxHeight: "calc(100vh - 56px)" }}>

            {/* Incident input */}
            <section style={{
              background: "var(--surface)", borderRadius: 12,
              border: "1px solid var(--border2)", marginBottom: "1rem",
              overflow: "hidden",
            }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Incident</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Paste a GitHub issue, incident description, or query. Include repo, customer, error IDs.
                </div>
              </div>
              <div style={{ padding: "14px 16px" }}>
                <textarea
                  rows={5}
                  placeholder="e.g. issue #1 in myorg/myrepo is causing payment failures for customer C-1001"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={running}
                  style={{
                    width: "100%", resize: "vertical", background: "var(--bg)",
                    border: "1px solid var(--border2)", borderRadius: 8,
                    padding: "10px 12px", fontSize: 13, lineHeight: 1.6,
                    color: "var(--text)", fontFamily: "inherit",
                    transition: "border-color 0.15s",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={run}
                    disabled={running || !message.trim()}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "9px 20px", borderRadius: 8,
                      background: running || !message.trim() ? "var(--surface2)" : "var(--indigo)",
                      color: running || !message.trim() ? "var(--muted)" : "#fff",
                      border: "none", fontSize: 13, fontWeight: 600,
                      cursor: running || !message.trim() ? "not-allowed" : "pointer",
                      transition: "opacity 0.15s, background 0.15s",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {running ? (
                      <>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} className="pulse-dot" />
                        Running…
                      </>
                    ) : (
                      <>
                        <PlayIcon className="h-3.5 w-3.5" />
                        Run diagnosis
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>

            {/* Error */}
            {error && (
              <div className="fadeIn" style={{
                display: "flex", gap: 10, background: "#EF444412",
                border: "1px solid #EF444430", borderRadius: 10,
                padding: "12px 14px", marginBottom: "1rem",
                fontSize: 13, color: "#FCA5A5",
              }}>
                <AlertIcon className="h-4 w-4" style={{ marginTop: 1, flexShrink: 0, color: "var(--red)" }} />
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Investigation stopped</div>
                  <div style={{ color: "#FDA4AF" }}>{error}</div>
                </div>
              </div>
            )}

            {/* Tab bar */}
            <div style={{
              display: "flex", gap: 2, marginBottom: "1rem",
              borderBottom: "1px solid var(--border)", paddingBottom: 0,
            }}>
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: "8px 14px", fontSize: 13, fontWeight: active ? 600 : 500,
                      color: active ? "var(--text)" : "var(--muted)",
                      background: "none", border: "none",
                      borderBottom: active ? "2px solid var(--indigo)" : "2px solid transparent",
                      marginBottom: "-1px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 6,
                      transition: "color 0.15s",
                    }}
                  >
                    {tab.label}
                    {tab.badge !== null && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "1px 6px",
                        borderRadius: 20, background: active ? "var(--indigo)" : "var(--surface2)",
                        color: active ? "#fff" : "var(--muted)", letterSpacing: 0,
                      }}>
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Timeline tab ── */}
            {activeTab === "timeline" && (
              <div className="fadeIn">
                {completedSteps.length === 0 ? (
                  <div style={{
                    border: "1px dashed var(--border)", borderRadius: 12,
                    padding: "48px 24px", textAlign: "center",
                    color: "var(--muted)", fontSize: 13,
                  }}>
                    <ActivityIcon className="h-8 w-8" style={{ margin: "0 auto 10px", color: "var(--muted)" }} />
                    Run diagnosis to see the investigation timeline.
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    {/* Vertical line */}
                    <div style={{
                      position: "absolute", left: 15, top: 24, bottom: 0,
                      width: 1, background: "var(--border)", pointerEvents: "none",
                    }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {completedSteps.map((step, i) => {
                        const isCurrent = running && i === completedSteps.length - 1;
                        return (
                          <div key={`${step.node}-${i}`} className="fadeIn" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                            <div style={{
                              width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginTop: 4,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              background: isCurrent ? "#6366F120" : "#10B98112",
                              border: `1px solid ${isCurrent ? "#6366F140" : "#10B98130"}`,
                              color: isCurrent ? "var(--indigo)" : "var(--emerald)",
                              zIndex: 1,
                            }}>
                              {isCurrent
                                ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--indigo)", display: "inline-block" }} className="pulse-dot" />
                                : <CheckIcon />}
                            </div>
                            <div style={{
                              flex: 1, background: "var(--surface2)", borderRadius: 10,
                              border: "1px solid var(--border)", padding: "10px 14px", marginBottom: 4,
                            }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                                {NODE_LABELS[step.node] ?? step.node}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>
                                {NODE_DESCRIPTIONS[step.node] ?? "Diagnostic graph step completed."}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Evidence tab ── */}
            {activeTab === "sources" && (
              <div className="fadeIn">
                {sourceList.length === 0 ? (
                  <div style={{
                    border: "1px dashed var(--border)", borderRadius: 12,
                    padding: "48px 24px", textAlign: "center", color: "var(--muted)", fontSize: 13,
                  }}>
                    <DatabaseIcon className="h-8 w-8" style={{ margin: "0 auto 10px" }} />
                    Source evidence appears here after investigation.
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    {sourceList.map((src) => (
                      <article key={src.sourceId} className="fadeIn" style={{
                        background: "var(--surface2)", borderRadius: 10,
                        border: "1px solid var(--border)",
                        borderTop: `2px solid ${src.status === "success" ? "var(--emerald)" : src.status === "partial" ? "var(--amber)" : "var(--red)"}`,
                        overflow: "hidden",
                      }}>
                        <div style={{ padding: "12px 14px 10px" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {src.sourceName}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                {src.category} · {src.integrationType}
                              </div>
                            </div>
                            <SourceStatusPill status={src.status} />
                          </div>
                          {typeof src.durationMs === "number" && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }} className="mono">
                              {src.durationMs}ms
                            </div>
                          )}
                        </div>

                        {src.query && (
                          <div style={{ borderTop: "1px solid var(--border)", background: "#6366F108" }}>
                            <div style={{ padding: "8px 14px" }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: "#818CF8", marginBottom: 4 }}>
                                QUERY
                              </div>
                              <pre style={{ fontSize: 11, lineHeight: 1.6, color: "#C7D2FE", whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "'JetBrains Mono', monospace" }}>
                                {src.query}
                              </pre>
                            </div>
                          </div>
                        )}
                        {src.error && (
                          <div style={{ borderTop: "1px solid var(--border)", background: "#EF444408" }}>
                            <div style={{ padding: "8px 14px" }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: "#F87171", marginBottom: 4 }}>
                                ERROR
                              </div>
                              <pre style={{ fontSize: 11, lineHeight: 1.6, color: "#FCA5A5", whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "'JetBrains Mono', monospace" }}>
                                {src.error}
                              </pre>
                            </div>
                          </div>
                        )}
                        <div style={{ borderTop: "1px solid var(--border)" }}>
                          <div style={{ padding: "8px 14px" }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                              DATA
                            </div>
                            <pre style={{ maxHeight: 200, overflow: "auto", fontSize: 11, lineHeight: 1.6, color: "var(--muted2)", whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "'JetBrains Mono', monospace" }}>
                              {formatValue(src.data)}
                            </pre>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Report tab ── */}
            {activeTab === "report" && (
              <div className="fadeIn" style={{ flex: 1 }}>
                {!report ? (
                  <div style={{
                    border: "1px dashed var(--border)", borderRadius: 12,
                    padding: "48px 24px", textAlign: "center", color: "var(--muted)", fontSize: 13,
                  }}>
                    <ActivityIcon className="h-8 w-8" style={{ margin: "0 auto 10px" }} />
                    The diagnostic report will appear here once investigation completes.
                  </div>
                ) : (
                  <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border2)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Diagnostic report</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Evidence-backed incident summary</div>
                      </div>
                      <button
                        type="button"
                        onClick={copyReport}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "6px 12px", borderRadius: 7,
                          border: "1px solid var(--border2)", background: "var(--surface2)",
                          color: copied ? "var(--emerald)" : "var(--muted2)",
                          fontSize: 12, fontWeight: 500, cursor: "pointer",
                          transition: "color 0.15s",
                        }}
                      >
                        <CopyIcon />
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <pre style={{ padding: "16px", maxHeight: "60vh", overflow: "auto", fontSize: 13, lineHeight: 1.75, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-words", fontFamily: "inherit" }}>
                      {report}
                    </pre>
                  </div>
                )}
              </div>
            )}

          </main>
        </div>
      </div>
    </>
  );
}