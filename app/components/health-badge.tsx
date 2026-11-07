import { CircleCheck, CircleSlash, CircleX, LoaderCircle } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { cn } from "@/app/lib/cn";
import type { HealthStatus } from "@/app/components/health-provider";

const STATUS_META = {
  up: { label: "Up", variant: "success" as const, icon: CircleCheck },
  down: { label: "Down", variant: "destructive" as const, icon: CircleX },
  disabled: {
    label: "Disabled",
    variant: "muted" as const,
    icon: CircleSlash,
  },
};

export function HealthStatusBadge({
  status,
  className,
}: {
  status: HealthStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <Badge variant={meta.variant} className={className}>
      <Icon />
      {meta.label}
    </Badge>
  );
}

export function HealthPill({
  status,
  upCount,
  downCount,
  loading,
  error,
  className,
}: {
  status?: "ok" | "degraded" | "down";
  upCount: number;
  downCount: number;
  loading: boolean;
  error: string | null;
  className?: string;
}) {
  const healthy = status === "ok";
  const degraded = status === "degraded" || status === "down";
  const label = error
    ? "Status unavailable"
    : status === undefined
      ? "Checking sources"
      : healthy
        ? "All sources operational"
        : degraded
          ? `${downCount} source${downCount === 1 ? "" : "s"} down`
          : "Sources unavailable";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium",
        healthy && "border-success/25 bg-success/10 text-success",
        degraded && "border-destructive/25 bg-destructive/10 text-destructive",
        !healthy &&
          !degraded &&
          "border-border bg-muted/60 text-muted-foreground",
        className
      )}
    >
      {loading && status === undefined ? (
        <LoaderCircle className="h-3 w-3 animate-spin" />
      ) : (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            healthy && "bg-success animate-pulse",
            degraded && "bg-destructive",
            !healthy && !degraded && "bg-muted-foreground/60"
          )}
        />
      )}
      {label}
      {healthy ? (
        <span className="font-mono text-[10px] opacity-70">
          {upCount} up
        </span>
      ) : null}
    </span>
  );
}
