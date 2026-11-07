"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type HealthStatus = "up" | "down" | "disabled";

export interface SourceHealth {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly category: string;
  readonly enabled: boolean;
  readonly status: HealthStatus;
  readonly latencyMs: number;
  readonly detail: string;
}

export interface HealthResponse {
  readonly status: "ok" | "degraded" | "down";
  readonly checkedAt: string;
  readonly sources: SourceHealth[];
  readonly error?: string;
}

interface HealthContextValue {
  readonly health: HealthResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
  readonly upCount: number;
  readonly downCount: number;
  readonly disabledCount: number;
  readonly enabledCount: number;
}

const HealthContext = createContext<HealthContextValue | null>(null);

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", { cache: "no-store" });
  const body = (await response.json()) as HealthResponse;

  if (!Array.isArray(body.sources)) {
    throw new Error(body.error ?? `Health endpoint returned ${response.status}`);
  }

  return body;
}

export function HealthProvider({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setHealth(await fetchHealth());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load source health"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchHealth()
      .then((body) => {
        if (!cancelled) setHealth(body);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load source health"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<HealthContextValue>(() => {
    const sources = health?.sources ?? [];
    const enabled = sources.filter((source) => source.enabled);

    return {
      health,
      loading,
      error,
      reload: load,
      upCount: sources.filter((source) => source.status === "up").length,
      downCount: sources.filter((source) => source.status === "down").length,
      disabledCount: sources.filter((source) => source.status === "disabled")
        .length,
      enabledCount: enabled.length,
    };
  }, [health, loading, error, load]);

  return (
    <HealthContext.Provider value={value}>{children}</HealthContext.Provider>
  );
}

export function useHealth() {
  const context = useContext(HealthContext);

  if (!context) {
    throw new Error("useHealth must be used within a HealthProvider");
  }

  return context;
}
