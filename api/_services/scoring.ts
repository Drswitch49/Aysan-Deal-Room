export interface ScoringMetric {
  id: string;
  name: string;
  weight: number;
  description: string;
}

export interface MetricScore {
  metricId: string;
  name: string;
  score: number; // 1-10
  explanation: string;
  isOverridden?: boolean;
}

export interface ScorecardResult {
  schemaId: string;
  metrics: MetricScore[];
  weightedScore: number; // 1-10 (e.g. 7.6)
  scoreOutOf50: number; // e.g. 38
  percentage: number; // e.g. 76
}

export const SCORING_SCHEMAS: Record<string, { name: string; metrics: ScoringMetric[] }> = {
  ACP_DEAL_ROOM: {
    name: "ACP Default Schema",
    metrics: [
      {
        id: "sector_fit",
        name: "Sector fit",
        weight: 0.20,
        description: "Alignment with preferred investment sectors (e.g. Commercial Cleaning) and UK geographies (e.g. London, Kent, South East)."
      },
      {
        id: "financials",
        name: "Financials",
        weight: 0.25,
        description: "EBITDA magnitude, revenue margins, financial stability, historical growth, and validation of owner add-backs."
      },
      {
        id: "transition_risk",
        name: "Transition risk",
        weight: 0.20,
        description: "Reliance on owner/founder, staff retention, notice periods, TUPE transfer complexity, and lease term stability."
      },
      {
        id: "lender_fit",
        name: "Lender fit",
        weight: 0.15,
        description: "Bankability of the business, predictable cash flows, tangible asset base, and suitability for senior debt leverage."
      },
      {
        id: "structure_viability",
        name: "Structure viability",
        weight: 0.20,
        description: "Seller openness to deal structures, vendor loan notes (VLN), deferred payments, and earn-outs."
      }
    ]
  },
  MODULAR_OPPORTUNITY: {
    name: "Modular Opportunity Schema",
    metrics: [
      {
        id: "meeting_sentiment",
        name: "Meeting sentiment",
        weight: 0.10,
        description: "Overall tone of the discovery call, seller's enthusiasm, alignment of expectations, and cooperativeness."
      },
      {
        id: "financial_strength",
        name: "Financial strength",
        weight: 0.15,
        description: "Gross margins, recurring revenue percentage, client concentration levels, and historical EBITDA growth."
      },
      {
        id: "acquisition_complexity",
        name: "Acquisition complexity",
        weight: 0.15,
        description: "TUPE complexity, lease assignments, client change-of-control clauses, and regulatory compliance requirements."
      },
      {
        id: "responsiveness",
        name: "Responsiveness",
        weight: 0.10,
        description: "Swiftness in sharing information, readiness to supply documents, and quality of broker communication."
      },
      {
        id: "operational_maturity",
        name: "Operational maturity",
        weight: 0.15,
        description: "Presence of middle management, robust IT systems/SOPs, and lack of dependency on founder operations."
      },
      {
        id: "industry_risk",
        name: "Industry risk",
        weight: 0.10,
        description: "Market competition, switching costs, regulatory risks, and susceptibility to economic cycles."
      },
      {
        id: "growth_potential",
        name: "Growth potential",
        weight: 0.10,
        description: "Scalability, expansion into new UK territories, upselling existing accounts, and sales automation."
      },
      {
        id: "strategic_alignment",
        name: "Strategic alignment",
        weight: 0.15,
        description: "Core strategic fit for ACP capital structure, synergy with platform companies, and return profile."
      }
    ]
  }
};

/**
 * Computes weighted scores, handling overrides.
 */
export function calculateScore(
  schemaId: string,
  aiScores: Record<string, { score: number; explanation: string }>,
  overrides: Record<string, number> = {}
): ScorecardResult {
  const schema = SCORING_SCHEMAS[schemaId] || SCORING_SCHEMAS.ACP_DEAL_ROOM;
  const metrics: MetricScore[] = [];
  let weightedSum = 0;

  for (const metric of schema.metrics) {
    const aiData = aiScores[metric.id] || { score: 5, explanation: "No AI assessment available." };
    const hasOverride = overrides[metric.id] !== undefined && overrides[metric.id] !== null;
    
    // Clamp score between 1 and 10
    const rawScore = hasOverride ? overrides[metric.id] : aiData.score;
    const finalScore = Math.min(10, Math.max(1, Math.round(rawScore)));

    metrics.push({
      metricId: metric.id,
      name: metric.name,
      score: finalScore,
      explanation: aiData.explanation,
      isOverridden: hasOverride
    });

    weightedSum += finalScore * metric.weight;
  }

  // Round weighted sum to 2 decimal places to prevent float issues
  const weightedScore = Math.round(weightedSum * 100) / 100;
  const percentage = Math.round((weightedScore / 10) * 100);
  const scoreOutOf50 = Math.round((weightedScore / 10) * 50 * 10) / 10; // e.g. 38.0

  return {
    schemaId,
    metrics,
    weightedScore,
    scoreOutOf50,
    percentage
  };
}

/**
 * Generates instructions for Claude on how to score each metric based on call logs.
 */
export function getPromptInstructions(schemaId: string): string {
  const schema = SCORING_SCHEMAS[schemaId] || SCORING_SCHEMAS.ACP_DEAL_ROOM;
  let text = `For each of the following categories, rate the opportunity from 1 to 10 (integers only) and provide a concise 1-2 sentence explanation of your rating based on the meeting notes and deal context:\n\n`;

  schema.metrics.forEach(m => {
    text += `- **${m.id}** ("${m.name}"): ${m.description} Rate 1 (very weak/high risk) to 10 (excellent fit/low risk).\n`;
  });

  text += `\nEnsure that you extract specific mentions of notice periods, lease terms, vendor loan note openness, customer concentration, and other structural items discussed in the call.`;
  return text;
}
