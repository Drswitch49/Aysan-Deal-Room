import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DealForm } from "../components/deals/DealForm";
import type { CreateDealInput } from "../types/entities";

export function CreateDealPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (dealData: CreateDealInput) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/deals-crud", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify(dealData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create deal");
      }

      const result = await response.json();
      navigate(`/deals/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

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
          <h1 className="text-4xl font-bold text-white">Create New Deal</h1>
          <p className="text-slate-400 mt-2">Add a new institutional deal to the pipeline</p>
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
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
