import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DealForm } from "../components/deals/DealForm";
import type { Deal, CreateDealInput } from "../types/entities";

export function EditDealPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDeal();
  }, [id]);

  const loadDeal = async () => {
    if (!id) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/deals-crud?id=${id}`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        }
      });

      if (!response.ok) throw new Error("Failed to load deal");
      const data = await response.json();
      setDeal(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (dealData: CreateDealInput) => {
    if (!id) return;

    try {
      const response = await fetch(`/api/deals-crud?id=${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify(dealData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update deal");
      }

      navigate(`/deals/${id}`);
    } catch (err) {
      throw err;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading deal...</p>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-slate-900">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <button
            onClick={() => navigate(-1)}
            className="text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Go Back
          </button>
          <p className="text-red-400">{error || "Deal not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-12">
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back
          </button>
          <h1 className="text-4xl font-bold text-white">Edit Deal</h1>
          <p className="text-slate-400 mt-2">{deal.dealRef} - {deal.companyName}</p>
        </div>

        {/* Global Error */}
        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Form */}
        <DealForm
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
          initialData={deal}
        />
      </div>
    </div>
  );
}
