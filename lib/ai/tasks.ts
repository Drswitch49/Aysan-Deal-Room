/**
 * Typed AI tasks (Phase 5b) — ported VERBATIM from the legacy raw-fetch
 * implementations (api/_services/ai.ts, api/_services/portfolio.ts) onto the
 * shared client. Prompts and models are unchanged by design; outputs are now
 * zod-validated with a repair retry instead of hand-rolled fallbacks.
 */
import { z } from "zod";
import { askClaude, askClaudeJson } from "./client.js";
import { getPromptInstructions, SCORING_SCHEMAS } from "../../api/_services/scoring.js";
import { ACP_PERSONAS } from "../../src/lib/acp/personas.js";
import { ACP_SCENARIOS } from "../../src/lib/acp/scenarios.js";

// ═══════════════════════════════════════════════════════════════════════════
//  Transcript analysis
// ═══════════════════════════════════════════════════════════════════════════
export const transcriptAnalysisSchema = z.object({
  summary: z.string().catch(""),
  discussionPoints: z.array(z.string()).catch([]),
  actionItems: z.array(z.string()).catch([]),
  risks: z.array(z.string()).catch([]),
  opportunities: z.array(z.string()).catch([]),
  sentiment: z.enum(["Positive", "Neutral", "Negative"]).catch("Neutral"),
  dealScore: z.number().min(0).max(100).catch(50),
});
export type TranscriptAnalysis = z.infer<typeof transcriptAnalysisSchema>;

const TRANSCRIPT_SYSTEM = `You are a senior investment associate at a private equity and acquisition firm.
Analyze the provided meeting transcript of a discovery call or partnership meeting between our deal team and a target company.
Identify key deal factors.

You MUST respond ONLY with a valid JSON object. Do not output any preamble, markdown formatting block fences (like \`\`\`json), or conversational filler. The output must be pure, parsable JSON matching this schema exactly:

{
  "summary": "A concise executive summary paragraph of the meeting, summarizing the deal context, business health, and meeting outcome.",
  "discussionPoints": [
    "Discussion point 1",
    "Discussion point 2"
  ],
  "actionItems": [
    "Action item 1 (e.g. send NDA, request 3-yr accounts)"
  ],
  "risks": [
    "Risk 1 (e.g. high customer concentration, key person dependency)"
  ],
  "opportunities": [
    "Opportunity 1 (e.g. low-hanging cross-selling synergy, market expansion)"
  ],
  "sentiment": "Positive" or "Neutral" or "Negative",
  "dealScore": 75
}

Note: The "dealScore" must be a number between 0 and 100 representing your qualitative assessment of the opportunity based on the transcript indicators (financial stability, management capability, growth prospects, scalability vs risks).`;

export function analyzeTranscript(transcriptText: string): Promise<TranscriptAnalysis> {
  return askClaudeJson(transcriptAnalysisSchema, {
    system: TRANSCRIPT_SYSTEM,
    maxTokens: 4000,
    messages: [{ role: "user", content: `Here is the cleaned meeting transcript to analyze:\n\n${transcriptText}` }],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Investment verdict
// ═══════════════════════════════════════════════════════════════════════════
export const investmentVerdictSchema = z.object({
  investmentVerdict: z.string().catch("Neutral: Requires further review."),
  investmentThesis: z.string().catch(""),
  strengths: z.array(z.string()).catch([]),
  risks: z.array(z.string()).catch([]),
  questionsRequiringValidation: z.array(z.string()).catch([]),
  recommendedNextStep: z.string().catch("Review IM"),
  confidenceLevel: z.enum(["High", "Medium", "Low"]).catch("Low"),
});
export type InvestmentVerdict = z.infer<typeof investmentVerdictSchema>;

const VERDICT_SYSTEM = `You are the Lead Investment Director at Aysan Capital Partners.
Your job is to provide a decisive, structured Investment Verdict on an incoming deal.
You will be given the company's financials, executive summary, business description, and available IM content.

Analyze the data and output ONLY a valid JSON object matching exactly this schema:
{
  "investmentVerdict": "A direct 1-2 sentence verdict: Strong, Positive, Neutral, Needs Validation, or Reject.",
  "investmentThesis": "The core rationale for why this business could be an attractive acquisition (or why it should be avoided).",
  "strengths": ["Key strength 1", "Key strength 2"],
  "risks": ["Critical risk 1", "Critical risk 2"],
  "questionsRequiringValidation": ["Validation question 1", "Validation question 2"],
  "recommendedNextStep": "A specific action for the deal team (e.g. 'Proceed to LOI', 'Schedule deep-dive call').",
  "confidenceLevel": "High" | "Medium" | "Low"
}

CRITICAL RULES:
- Output pure JSON only. No markdown fences. No conversational filler.
- Do NOT fabricate financial numbers. Rely only on the provided data.
- If data is sparse, confidenceLevel should be Low and questionsRequiringValidation should focus on missing critical data.`;

export interface VerdictDealInput {
  companyName?: string | null;
  dealRef?: string | null;
  sector?: string | null;
  location?: string | null;
  revenue?: number | string | null;
  ebitda?: number | string | null;
  askingPrice?: number | string | null;
  enterpriseValue?: number | string | null;
  executiveSummary?: string | null;
  businessDescription?: string | null;
  internalNotes?: string | null;
  hasImAttached?: boolean;
}

export function generateInvestmentVerdict(deal: VerdictDealInput): Promise<InvestmentVerdict> {
  const userContent = `Here is the deal information:
- Company Name: ${deal.companyName || deal.dealRef}
- Sector: ${deal.sector}
- Location: ${deal.location}
- Revenue/Turnover: £${deal.revenue}
- EBITDA: £${deal.ebitda}
- Asking Price: £${deal.askingPrice}
- Enterprise Value: £${deal.enterpriseValue || ""}

Executive Summary:
${deal.executiveSummary || "Not provided"}

Business Description:
${deal.businessDescription || "Not provided"}

Internal Notes / Extracted IM Review text:
${deal.internalNotes || ""}
${deal.hasImAttached ? "Has IM attached." : "No IM attached."}`;

  return askClaudeJson(investmentVerdictSchema, {
    system: VERDICT_SYSTEM,
    maxTokens: 2000,
    messages: [{ role: "user", content: userContent }],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Pre-call brief
// ═══════════════════════════════════════════════════════════════════════════
export const precallBriefSchema = z.object({
  executiveDealSnapshot: z.string().catch(""),
  callObjectives: z.string().catch(""),
  criticalUnknowns: z.array(z.string()).catch([]),
  dealKillers: z.array(z.string()).catch([]),
  osintIntelligence: z.string().catch(""),
  financialIntelligence: z.string().catch(""),
  sellerIntelligence: z.string().catch(""),
  teamDeploymentPlan: z.array(z.record(z.string(), z.unknown())).catch([]),
  participantResponsibilities: z.string().catch(""),
  callPhaseOwnership: z.array(z.record(z.string(), z.unknown())).catch([]),
  participantQuestionBank: z.array(z.record(z.string(), z.unknown())).catch([]),
  internalWatchouts: z.array(z.string()).catch([]),
  partnerDownCoverage: z.string().catch(""),
  callStrategy: z.string().catch(""),
  callScript: z.string().catch(""),
  recommendedNextActions: z.array(z.string()).catch([]),
});
export type PrecallBrief = z.infer<typeof precallBriefSchema>;

export interface PrecallParams {
  selectedCallType: string;
  selectedPersonas: string[];
  selectedScenario: string;
  dataSources: string[];
  pastedText?: string;
}

export function generatePrecallBrief(dealData: any, params: PrecallParams): Promise<PrecallBrief> {
  const callTypeLabel =
    params.selectedCallType === "1st" ? "1st Seller Call"
    : params.selectedCallType === "2nd" ? "2nd Follow-up Call"
    : "Negotiation";

  const activePersonas = (params.selectedPersonas || []).map((id) => (ACP_PERSONAS as any)[id]).filter(Boolean);
  const personaContext = activePersonas.length > 0
    ? `\n\nPARTICIPANT PERSONAS AND RULES:\n` + activePersonas.map((p: any) => `
Name: ${p.name}
Role: ${p.role}
Authority Level: ${p.authorityLevel}
Working Style: ${p.workingStyle}
Strengths: ${p.strengths?.join(", ")}
Weaknesses: ${p.weaknesses?.join(", ")}
Responsibilities: ${p.responsibilities?.join(", ")}
Best Deployed On: ${p.bestDeployedOn?.join(", ")}
How AI Writes For Them: ${p.howAIWritesForThem}
Call Ownership Areas: ${p.callOwnership?.join(", ")}
Partner-Down Rules: ${p.partnerDownRules?.join(" ")}
Escalation Rules: ${p.escalationRules?.join(" ")}
`).join("\n---\n")
    : "\n\nNo specific personas selected. Default ACP rules apply.";

  const activeScenario = params.selectedScenario ? (ACP_SCENARIOS as any)[params.selectedScenario] : null;
  const scenarioContext = activeScenario
    ? `\n\nCOVERAGE SCENARIO & CONTINGENCY PROTOCOL:\n` +
      `Scenario: ${activeScenario.name}\n` +
      `Description: ${activeScenario.description}\n` +
      `Lead: ${(ACP_PERSONAS as any)[activeScenario.lead]?.name || activeScenario.lead}\n` +
      `Second Seat: ${activeScenario.secondSeat ? ((ACP_PERSONAS as any)[activeScenario.secondSeat]?.name || activeScenario.secondSeat) : "None"}\n` +
      (activeScenario.openingScript ? `\nMandatory Opening Script (Inject into Call Script):\n"""${activeScenario.openingScript}"""\n` : "") +
      `\nMandatory Holding Script (Inject into Call Script / Objection Handlers if seller pushes for numbers/commitments):\n"""${activeScenario.holdingScript}"""\n` +
      `\nHARD GUARDRAILS (UNCHANGED IN EVERY SCENARIO):\n${activeScenario.hardGuardrails.map((g: string) => "- " + g).join("\n")}\n`
    : "";

  const systemPrompt = `You are the ACP (Aysan Capital Partners) pre-call intelligence and vendor-call strategist.
Your job is to prepare ACP partners for a founder/vendor call on a live acquisition opportunity.
The output must be an institutional-quality acquisition briefing (Private Equity IC Preparation style) — not a generic AI report.

INPUTS AVAILABLE
Broker/CIM, Financial statements, Companies House data, OSINT, Email trails, Prior ACP discussions, Deal scorecards, Acquisition thesis, Geography and sector fit.
${personaContext}
${scenarioContext}

CRITICAL: You MUST respond ONLY with valid JSON. Do not include markdown wrappers or any text outside the JSON object.
Use this exact JSON schema:
{
  "executiveDealSnapshot": "[Write the Executive Deal Snapshot here]",
  "callObjectives": "[Write the Call Objectives here]",
  "criticalUnknowns": ["[Write Unknown 1]", "[Write Unknown 2]"],
  "dealKillers": ["[Write Killer 1]"],
  "osintIntelligence": "[Write OSINT Intelligence here]",
  "financialIntelligence": "[Write Financial Intelligence here]",
  "sellerIntelligence": "[Write Seller Intelligence here]",
  "teamDeploymentPlan": [
    {
      "name": "[Participant Name]",
      "roleOnCall": "[Role]",
      "primaryResponsibilities": ["[Resp 1]", "[Resp 2]"],
      "questionsToOwn": ["[Topic 1]", "[Topic 2]"],
      "riskAreasToInvestigate": ["[Risk 1]"],
      "areasToAvoid": ["[Avoid 1]"],
      "successCriteria": "[Criteria]"
    }
  ],
  "participantResponsibilities": "[Write Participant Responsibilities detailed overview here]",
  "callPhaseOwnership": [
    { "phase": "Opening", "owner": "[Name]" },
    { "phase": "Relationship Building", "owner": "[Name]" },
    { "phase": "Operational Discovery", "owner": "[Name]" },
    { "phase": "Financial Discovery", "owner": "[Name]" },
    { "phase": "Risk Discovery", "owner": "[Name]" },
    { "phase": "Seller Motivation", "owner": "[Name]" },
    { "phase": "Transition Planning", "owner": "[Name]" },
    { "phase": "Closing", "owner": "[Name]" }
  ],
  "participantQuestionBank": [
    {
      "participantName": "[Name]",
      "primaryQuestions": ["[Q1]"],
      "followUpQuestions": ["[Q2]"],
      "escalationQuestions": ["[Q3]"]
    }
  ],
  "internalWatchouts": ["[Watchout 1]"],
  "partnerDownCoverage": "[Explain how partner-down rules were applied based on COVERAGE SCENARIO]",
  "callStrategy": "[Write Call Strategy here]",
  "callScript": "[Write Call Script here. Inject Opening Script if provided in scenario. Inject Holding Script for objections]",
  "recommendedNextActions": ["[Action 1]", "[Action 2]"]
}

STYLE RULES (MANDATORY):
- Sound like an ACP partner wrote it.
- Be commercially sharp.
- Use plain spoken founder language, not consultant jargon.
- Apply the specific persona strengths, weaknesses, and partner-down logic dynamically based on who is attending.
- Apply the COVERAGE SCENARIO explicit Lead and Second Seat roles. Do not assign phases to absent people.
- STRICTLY ENFORCE ALL HARD GUARDRAILS.
- Assign ownership for every section based strictly on the selected personas and their partner-down rules.
- Never fabricate facts; clearly label assumptions.

BREVITY AND LIMITS (CRITICAL):
- You MUST be extremely concise. Keep your total JSON output under 15,000 characters.
- Keep the 'callScript' under 200 words.
- In 'teamDeploymentPlan' and 'participantQuestionBank', limit bullet points to a maximum of 2 short items per person.
- Limit 'participantResponsibilities' to a brief 2-3 sentence overview.
- If many participants are selected, compress their data into tight summaries rather than writing essays.`;

  const userContent = `Company: ${dealData.companyName || dealData.dealRef}
Sector: ${dealData.sector} | Location: ${dealData.location}
EV: ${dealData.evAsk ? `£${dealData.evAsk}` : "TBC"}
Revenue: ${dealData.revenue ? `£${dealData.revenue}` : "TBC"}
EBITDA: ${dealData.ebitda ? `£${dealData.ebitda}` : "TBC"}
EV Multiple: ${dealData.multiplier || "TBC"}
Call Type: ${callTypeLabel}
Selected Participants: ${activePersonas.map((p: any) => p.name).join(", ") || "None"}
Sources: ${(params.dataSources || []).join(", ")}
${params.pastedText ? `\nIM Text:\n${params.pastedText.substring(0, 3000)}` : ""}`;

  return askClaudeJson(precallBriefSchema, {
    system: systemPrompt,
    maxTokens: 8000,
    messages: [{ role: "user", content: userContent }],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Post-call brief + scoring
// ═══════════════════════════════════════════════════════════════════════════
const metricScoreSchema = z.object({
  score: z.number().catch(5),
  explanation: z.string().catch("No AI explanation provided."),
});
export const postcallBriefSchema = z.object({
  summary: z.string().catch("Discovery call complete. Key details analyzed."),
  scores: z.record(z.string(), metricScoreSchema).catch({}),
  followUpEmail: z.string().catch("Dear team, the follow-up email draft is pending."),
});
export type PostcallBrief = z.infer<typeof postcallBriefSchema>;

export async function generatePostcallBrief(deal: any, notes: string, schemaId: string): Promise<PostcallBrief> {
  const schema = (SCORING_SCHEMAS as any)[schemaId] || (SCORING_SCHEMAS as any).ACP_DEAL_ROOM;
  const scoringInstructions = getPromptInstructions(schemaId);

  const systemPrompt = `You are a senior investment director at Aysan Capital Partners (ACP).
Analyze the provided meeting notes or transcript from a discovery call with a target company's owner/broker.
Your task is to:
1. Write a professional, concise executive post-call summary paragraph (under 4 sentences) outlining key call outcomes, risks, and next steps.
2. Score the opportunity across the defined metrics.
3. Draft a professional, warm, yet direct follow-up email to the broker/seller summarizing the call, confirming interest, and requesting typical next-step documents (e.g. 3-year accounts, staff structures, client concentration details, lease agreements).

${scoringInstructions}

You MUST respond ONLY with a valid JSON object. Do not output any preamble, markdown formatting block fences (like \`\`\`json), or conversational filler. The output must be pure, parsable JSON matching this schema exactly:

{
  "summary": "Executive summary paragraph...",
  "scores": {
    ${schema.metrics.map((m: any) => `"${m.id}": { "score": 8, "explanation": "..." }`).join(",\n    ")}
  },
  "followUpEmail": "Subject: Next Steps - [Company Name]...\\n\\nDear [Name],..."
}`;

  const userContent = `Here is the target company information:
- Company Name: ${deal.companyName || deal.dealRef}
- Sector: ${deal.sector}
- Location: ${deal.location}
- Asking Price (EV): ${deal.evAsk ? `£${deal.evAsk}` : "TBC"}
- Revenue/Turnover: ${deal.revenue ? `£${deal.revenue}` : "TBC"}
- EBITDA: ${deal.ebitda ? `£${deal.ebitda}` : "TBC"}
- EV Multiple: ${deal.multiplier || "TBC"}

Here are the call notes/transcript:
${notes}

Perform your analysis and return the JSON object.`;

  const parsed = await askClaudeJson(postcallBriefSchema, {
    system: systemPrompt,
    maxTokens: 4000,
    messages: [{ role: "user", content: userContent }],
  });

  // Ensure every schema metric has a bounded score (legacy behavior preserved).
  const validatedScores: PostcallBrief["scores"] = {};
  for (const m of schema.metrics as Array<{ id: string }>) {
    const metricScore = parsed.scores?.[m.id] ?? { score: 5, explanation: "No AI explanation provided." };
    validatedScores[m.id] = {
      score: Math.min(10, Math.max(1, Math.round(metricScore.score))),
      explanation: metricScore.explanation || "No AI explanation provided.",
    };
  }
  return { ...parsed, scores: validatedScores };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Pre-call Q&A + portfolio briefing (plain text)
// ═══════════════════════════════════════════════════════════════════════════
export function answerPrecallQuestion(
  deal: any,
  brief: any,
  question: string,
  history: Array<{ q: string; a: string }>,
): Promise<string> {
  const systemPrompt = `You are a private equity investment assistant at Aysan Capital Partners.
The user (Ayo or another deal team member) is preparing for a call with the target company '${deal.companyName || deal.dealRef}'.
They have generated a pre-call intelligence brief and are asking you a question about the business, transaction structure, or preparation for the call.

Based on the company details, the brief profile, and the Q&A history, provide a concise, professional, and insight-driven answer. Keep it under 3-4 sentences if possible. Focus on transaction details, TUPE, notice periods, lease terms, or deal positioning.`;

  const messages: AskMessages = [];
  for (const h of history ?? []) {
    messages.push({ role: "user", content: h.q });
    messages.push({ role: "assistant", content: h.a });
  }
  messages.push({
    role: "user",
    content: `Brief Context:
- Company Snapshot: ${brief.companySnapshot}
- Investment Thesis: ${brief.investmentThesis}
- Key Risks: ${(brief.keyRisks ?? []).join(", ")}
- Priority Questions: ${(brief.priorityQuestions ?? []).join(", ")}

Deal Context:
- Sector: ${deal.sector}
- Location: ${deal.location}
- EV Multiple: ${deal.multiplier}
- Turnover: ${deal.revenue}
- EBITDA: ${deal.ebitda}

User Question: ${question}`,
  });

  return askClaude({ system: systemPrompt, maxTokens: 1000, messages });
}
type AskMessages = Array<{ role: "user" | "assistant"; content: string }>;

export function generatePortfolioBriefing(metrics: any[], healths: any[], alerts: any[]): Promise<string> {
  const systemPrompt = `You are a senior portfolio monitoring director at Aysan Capital Partners.
Your job is to provide an institutional-grade monthly/weekly portfolio intelligence briefing summarizing overall health and key risk areas across our portfolio companies.
You are given aggregated health scores, active alerts, and recent metrics.
Analyze this data and write a concise, professional briefing report (2-3 paragraphs) structured as follows:
1. Executive Summary: The overall portfolio health index and general status. Highlight the number of active alerts and if there are any immediate concerns.
2. Underperforming Assets: Specifically call out companies showing worrying signs (e.g. Clear Water Cleaning's revenue decline, DSCR contraction, or headcount drops).
3. Recommended Action Items: Concrete steps for the operational team to take (e.g., requesting audit accounts, scheduling seller calls, or renegotiating leverage covenants).

CRITICAL RULE:
- Do NOT invent metrics or scores.
- Rely ONLY on the provided numbers and alerts.
- Do NOT output preamble or conversational filler. Respond directly with the briefing text.`;

  const userContent = `Here is the portfolio state:
Health Scores:
${healths.map((h) => `- ${h.companyName}: Score ${h.portfolioScore}/100, Risk Level: ${h.riskLevel}, Trend: ${h.trendSummary}`).join("\n")}

Active Alerts:
${alerts.length === 0 ? "No active alerts." : alerts.map((a) => `- [${String(a.severity).toUpperCase()}] ${a.companyName}: ${a.explanation}`).join("\n")}

Latest Metrics:
${metrics.map((m) => `- ${m.companyName} (${m.reportingPeriod}): Rev: £${Number(m.revenue).toLocaleString()}, EBITDA: £${Number(m.ebitda).toLocaleString()}, DSCR: ${m.dscr}x, Lev: ${m.leverage}x, Headcount: ${m.headcount}`).join("\n")}
`;

  return askClaude({ system: systemPrompt, maxTokens: 2000, messages: [{ role: "user", content: userContent }] });
}
