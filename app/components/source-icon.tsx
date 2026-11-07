import { Activity, Database, FileText, Server } from "lucide-react";
import { GithubIcon } from "@/app/components/icons";
import { cn } from "@/app/lib/cn";

export function SourceIcon({
  type,
  category,
  className,
}: {
  type: string;
  category: string;
  className?: string;
}) {
  const shared = cn("h-4 w-4", className);

  if (type === "github") return <GithubIcon className={shared} />;
  if (category === "metrics") return <Activity className={shared} />;
  if (category === "logs") return <FileText className={shared} />;
  if (type === "postgres" || type === "sqlite")
    return <Database className={shared} />;

  return <Server className={shared} />;
}

const SOURCE_LABELS: Record<string, string> = {
  database: "Application DB",
  logs: "Log store",
  postgres: "PostgreSQL",
  metrics: "Prometheus",
  github: "GitHub",
};

export function sourceDisplayName(source: {
  id: string;
  name: string;
}): string {
  return SOURCE_LABELS[source.id] ?? source.name;
}
