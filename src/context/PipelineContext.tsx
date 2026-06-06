import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { getDeals } from "../api/airtable";
import type { PipelineDeal } from "../types/deal";

interface PipelineContextType {
  deals: PipelineDeal[];
  liveDealsCount: number;
  overdueCount: number;
  loading: boolean;
  error: string;
  refresh: () => void;
}

const PipelineContext = createContext<PipelineContextType | undefined>(undefined);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDeals()
      .then(data => {
        if (active) {
          setDeals(data);
          setError("");
        }
      })
      .catch(err => {
        if (active) {
          console.error("Failed to load pipeline deals in context:", err);
          setError("Failed to load deals.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshTrigger]);

  const liveDealsCount = useMemo(() => {
    return deals.filter(d => (d.status || "").toLowerCase() !== "killed").length;
  }, [deals]);

  const overdueCount = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    return deals.filter(d => {
      // Only check overdue for active deals (not killed)
      if ((d.status || "").toLowerCase() === "killed") return false;
      const actDate = d.rawFields?.["Next Action Date"];
      const actText = d.rawFields?.["Next Action"];
      return actDate && actText && actDate < todayStr;
    }).length;
  }, [deals]);

  const value = useMemo(() => ({
    deals,
    liveDealsCount,
    overdueCount,
    loading,
    error,
    refresh
  }), [deals, liveDealsCount, overdueCount, loading, error, refresh]);

  return (
    <PipelineContext.Provider value={value}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline() {
  const context = useContext(PipelineContext);
  if (context === undefined) {
    throw new Error("usePipeline must be used within a PipelineProvider");
  }
  return context;
}
