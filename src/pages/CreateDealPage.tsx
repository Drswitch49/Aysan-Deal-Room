import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DealForm } from "../components/deals/DealForm";
import type { CreateDealInput } from "../types/entities";

export function CreateDealPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: CreateDealInput) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/deals-crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to create deal");
      }

      navigate("/deals");
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between border-b border-white/[0.02] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Create New Deal</h1>
          <p className="mt-1 text-xs text-slate-500 font-medium">
            Add a new deal to the ACP pipeline. Reference numbers are generated automatically.
          </p>
        </div>
        <button
          onClick={() => navigate("/deals")}
          className="h-9 rounded-xl border border-white/[0.02] bg-white/[0.02] px-4 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white hover:bg-white/[0.04] transition cursor-pointer"
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-xs font-semibold text-rose-400">
          {error}
        </div>
      )}

      <DealForm onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  );
}
