import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DealForm } from "../components/deals/DealForm";
import { LoadingState } from "../components/ui/LoadingState";
import type { CreateDealInput, Deal } from "../types/entities";

export function EditDealPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  
  const [deal, setDeal] = useState<Deal | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    
    const fetchDeal = async () => {
      try {
        const response = await fetch(`/api/deals-crud?id=${encodeURIComponent(id)}`);
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to load deal");
        }
        const data = await response.json();
        setDeal(data);
      } catch (err: any) {
        setError(err.message || "Failed to load deal data");
      } finally {
        setIsFetching(false);
      }
    };
    
    fetchDeal();
  }, [id]);

  const handleSubmit = async (data: CreateDealInput) => {
    if (!id) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/deals-crud?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to update deal");
      }

      navigate(-1); // Go back to where we came from
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
    return <LoadingState variant="table" label="Loading deal details..." />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between border-b border-white/[0.02] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Edit Deal</h1>
          <p className="mt-1 text-xs text-slate-500 font-medium">
            {deal?.companyName} {deal?.dealRef ? `— ${deal.dealRef}` : ""}
          </p>
        </div>
        <button
          onClick={() => navigate(-1)}
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

      {deal && (
        <DealForm 
          initialData={deal as Partial<CreateDealInput>} 
          onSubmit={handleSubmit} 
          isLoading={isLoading} 
        />
      )}
    </div>
  );
}
