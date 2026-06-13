/**
 * Service to interact with the Anthropic API to analyze meeting transcripts.
 */

import { getPromptInstructions, SCORING_SCHEMAS } from "./scoring.js";

export interface AnalysisResult {
  summary: string;
  discussionPoints: string[];
  actionItems: string[];
  risks: string[];
  opportunities: string[];
  sentiment: "Positive" | "Neutral" | "Negative";
  dealScore: number;
}

export async function analyzeTranscriptWithAI(transcriptText: string): Promise<AnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not configured.");
  }

  const systemPrompt = `You are a senior investment associate at a private equity and acquisition firm.
Analyze the provided meeting transcript of a discovery call/partnership meeting.
Generate a highly concise, partner-ready analysis. Restrict explanations and narratives to key high-signal facts only.

You MUST respond ONLY with a valid JSON object. Do not output any preamble, markdown formatting block fences, or conversational filler. The output must be pure, parsable JSON matching this schema exactly:

{
  "summary": "A single, highly dense executive summary paragraph (under 3 sentences) covering deal context, viability, and core meeting outcome.",
  "discussionPoints": [
    "Discussion point (max 3-4 bullets, each under 15 words)"
  ],
  "actionItems": [
    "Action item (max 3-4 bullets, each under 10 words)"
  ],
  "risks": [
    "Critical risk (max 3-4 bullets, each under 12 words)"
  ],
  "opportunities": [
    "Core opportunity (max 3-4 bullets, each under 12 words)"
  ],
  "sentiment": "Positive" or "Neutral" or "Negative",
  "dealScore": 75
}

Note: The "dealScore" must be a number between 0 and 100 representing your qualitative assessment of the opportunity based on transcript indicators.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Here is the cleaned meeting transcript to analyze:\n\n${transcriptText}`
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic Claude API call failed: ${response.status} - ${errorText}`);
  }

  const payload = await response.json();
  const rawContent = payload.content?.[0]?.text || "";

  if (!rawContent) {
    throw new Error("No analysis content returned from Anthropic Claude API.");
  }

  try {
    // Clean potential markdown block fences if Claude outputs them despite instruction
    let cleanJsonStr = rawContent.trim();
    if (cleanJsonStr.startsWith("```")) {
      cleanJsonStr = cleanJsonStr.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsed: AnalysisResult = JSON.parse(cleanJsonStr);
    
    // Ensure all arrays and fields are present with correct fallbacks
    return {
      summary: parsed.summary || "",
      discussionPoints: Array.isArray(parsed.discussionPoints) ? parsed.discussionPoints : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : [],
      sentiment: ["Positive", "Neutral", "Negative"].includes(parsed.sentiment) ? parsed.sentiment : "Neutral",
      dealScore: typeof parsed.dealScore === "number" ? Math.min(100, Math.max(0, parsed.dealScore)) : 50
    };
  } catch (err: any) {
    console.error("[Claude Parsing Error] Raw response:", rawContent);
    throw new Error(`Failed to parse AI response into structured JSON: ${err.message}`);
  }
}

export interface PrecallBriefResult {
  // Redesigned structured fields
  overview?: string;
  financials?: string;
  rationale?: string;
  risks?: string;
  openingTone?: string;
  openingThesis?: string;
  openingIcebreaker?: string;
  openingSensitivities?: string;
  questionsToAsk: string[];

  // Legacy fallback compatibility
  businessProfile: string;
  openingAngle: string;
}

export async function generatePrecallBriefWithAI(
  deal: any,
  params: {
    selectedCallType: string;
    attendees: string[];
    dataSources: string[];
    pastedText?: string;
  }
): Promise<PrecallBriefResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not configured.");
  }

  const systemPrompt = `You are a senior investment associate at Aysan Capital Partners (ACP).
Prepare a Pre-call Intelligence Brief.
Strive for extreme brevity, clarity, and partner-grade signal density. Avoid long essays, filler language, and redundant observations.
Use structured, concise bullet points or short, single-sentence insights.

You MUST respond ONLY with a valid JSON object. Do not output any preamble, markdown formatting block fences (like \`\`\`json), or conversational filler. The output must be pure, parsable JSON matching this schema exactly:

{
  "overview": "A very brief summary (under 2 sentences) of target business activities, core services, and market footprint.",
  "financials": "Concise, high-yield bulleted analysis of key metrics (Turnover, EBITDA, Multiples, Asking Price) and multiple reasonableness.",
  "rationale": "1-2 brief bullets outlining strategic alignment with ACP's investment thesis.",
  "risks": "2-3 key transition/operational risks (owner dependency, lease terms, staff TUPE) in short bullets.",
  "openingTone": "Call atmosphere guidance (1 sentence).",
  "openingThesis": "Messaging angle highlighting continuity and execution (1-2 sentences).",
  "openingIcebreaker": "Specific hook tailored to target (1 sentence).",
  "openingSensitivities": "Actionable advice for sensitive transition topics (1-2 sentences).",
  "questionsToAsk": [
    "3-4 diagnostic, high-impact questions on transition, client concentration, and deferred payment flexibility."
  ]
}`;

  const userContent = `Here is the target company information:
- Company Name: ${deal.companyName || deal.dealRef}
- Sector: ${deal.sector}
- Location: ${deal.location}
- Asking Price (EV): ${deal.evAsk ? `£${deal.evAsk}` : "TBC"}
- Revenue/Turnover: ${deal.revenue ? `£${deal.revenue}` : "TBC"}
- EBITDA: ${deal.ebitda ? `£${deal.ebitda}` : "TBC"}
- EV Multiple: ${deal.multiplier || "TBC"}

Call Parameters:
- Call Type: ${params.selectedCallType === "1st" ? "1st Seller Call" : params.selectedCallType === "2nd" ? "2nd Follow-up Call" : "Negotiation"}
- Deal Team Attendees: ${params.attendees.join(", ")}
- Enabled Intelligence Sources: ${params.dataSources.join(", ")}

${params.pastedText ? `Additional Information Memorandum (IM) Text:\n\n${params.pastedText}` : ""}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic Claude API call failed: ${response.status} - ${errorText}`);
  }

  const payload = await response.json();
  const rawContent = payload.content?.[0]?.text || "";

  if (!rawContent) {
    throw new Error("No brief content returned from Anthropic Claude API.");
  }

  try {
    let cleanJsonStr = rawContent.trim();
    if (cleanJsonStr.startsWith("```")) {
      cleanJsonStr = cleanJsonStr.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsed: any = JSON.parse(cleanJsonStr);
    
    // Construct fallbacks in case of older UI usage
    const businessProfileFallback = [
      parsed.overview ? `**EXECUTIVE OVERVIEW**\n${parsed.overview}` : "",
      parsed.financials ? `**FINANCIAL PROFILE**\n${parsed.financials}` : "",
      parsed.rationale ? `**STRATEGIC RATIONALE**\n${parsed.rationale}` : "",
      parsed.risks ? `**OPERATIONAL & TRANSITION RISKS**\n${parsed.risks}` : ""
    ].filter(Boolean).join("\n\n");

    const openingAngleFallback = [
      parsed.openingTone ? `**COMMUNICATION STYLE**\n${parsed.openingTone}` : "",
      parsed.openingThesis ? `**ACQUISITION THESIS POSITIONING**\n${parsed.openingThesis}` : "",
      parsed.openingIcebreaker ? `**HOOK / ICEBREAKER**\n${parsed.openingIcebreaker}` : "",
      parsed.openingSensitivities ? `**OBSTACLE / SENSITIVITY MANAGEMENT**\n${parsed.openingSensitivities}` : ""
    ].filter(Boolean).join("\n\n");

    return {
      overview: parsed.overview || "",
      financials: parsed.financials || "",
      rationale: parsed.rationale || "",
      risks: parsed.risks || "",
      openingTone: parsed.openingTone || "",
      openingThesis: parsed.openingThesis || "",
      openingIcebreaker: parsed.openingIcebreaker || "",
      openingSensitivities: parsed.openingSensitivities || "",
      questionsToAsk: Array.isArray(parsed.questionsToAsk) ? parsed.questionsToAsk : [],
      
      businessProfile: parsed.businessProfile || businessProfileFallback,
      openingAngle: parsed.openingAngle || openingAngleFallback
    };
  } catch (err: any) {
    console.error("[Claude Parsing Error for Brief] Raw response:", rawContent);
    throw new Error(`Failed to parse brief AI response into structured JSON: ${err.message}`);
  }
}

export async function answerPrecallQuestionWithAI(
  deal: any,
  brief: PrecallBriefResult,
  question: string,
  history: Array<{ q: string; a: string }>
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not configured.");
  }

  const systemPrompt = `You are a private equity investment assistant at Aysan Capital Partners.
The user (Ayo or another deal team member) is preparing for a call with the target company '${deal.companyName || deal.dealRef}'.
They have generated a pre-call intelligence brief and are asking you a question about the business, transaction structure, or preparation for the call.

Based on the company details, the brief profile, and the Q&A history, provide a concise, professional, and insight-driven answer. Keep it under 3-4 sentences if possible. Focus on transaction details, TUPE, notice periods, lease terms, or deal positioning.`;

  const messages: any[] = [];
  if (history && history.length > 0) {
    history.forEach(h => {
      messages.push({ role: "user", content: h.q });
      messages.push({ role: "assistant", content: h.a });
    });
  }
  messages.push({
    role: "user",
    content: `Brief Context:
- Profile: ${brief.businessProfile}
- Opening Angle: ${brief.openingAngle}
- Key Questions: ${brief.questionsToAsk.join(", ")}

Deal Context:
- Sector: ${deal.sector}
- Location: ${deal.location}
- EV Multiple: ${deal.multiplier}
- Turnover: ${deal.revenue}
- EBITDA: ${deal.ebitda}

User Question: ${question}`
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic Claude API call failed: ${response.status} - ${errorText}`);
  }

  const payload = await response.json();
  const rawContent = payload.content?.[0]?.text || "";

  if (!rawContent) {
    throw new Error("No answer returned from Anthropic Claude API.");
  }

  return rawContent.trim();
}

export interface PostcallMetricScore {
  score: number;
  explanation: string;
}

export interface PostcallBriefResult {
  // Redesigned structured fields
  strategicAlignment?: string;
  financialReality?: string;
  redFlags?: string;
  dealStructure?: string;
  nextSteps?: string;

  // Legacy fallback compatibility
  summary: string;
  scores: Record<string, PostcallMetricScore>;
  followUpEmail: string;
}

export async function generatePostcallBriefAndScoreWithAI(
  deal: any,
  notes: string,
  schemaId: string
): Promise<PostcallBriefResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not configured.");
  }

  const schema = SCORING_SCHEMAS[schemaId] || SCORING_SCHEMAS.ACP_DEAL_ROOM;
  const scoringInstructions = getPromptInstructions(schemaId);

  const systemPrompt = `You are a senior investment director at Aysan Capital Partners (ACP).
Analyze the discovery call notes/transcript.
Ensure all outputs are extremely brief, direct, structured as bullets or short comments, and focus purely on high-signal intelligence for fast executive comprehension.

${scoringInstructions}

You MUST respond ONLY with a valid JSON object. Do not output any preamble, markdown formatting block fences (like \`\`\`json), or conversational filler. The output must be pure, parsable JSON matching this schema exactly:

{
  "strategicAlignment": "1-2 sentence executive summary of call outcomes and alignment with Aysan's investment thesis.",
  "financialReality": "2-3 short, structured bullets detailing true financial metrics, normalized EBITDA, multiple expectations, and valuation sanity.",
  "redFlags": "2-3 critical operational/transition risks in short bullets.",
  "dealStructure": "2-3 short bullets detailing seller flexibility regarding deferred payment, VLN, earn-out, or rollover.",
  "nextSteps": "2-3 concrete validation steps and information requests before LOI progression.",
  "scores": {
    ${schema.metrics.map(m => `"${m.id}": { "score": 8, "explanation": "1 concise sentence explanation." }`).join(",\n    ")}
  },
  "followUpEmail": "Subject: Next Steps - [Company Name]...\\n\\nDear [Name],\\n\\n[A highly professional, brief, direct follow-up email confirming interest and requesting key documents (accounts, staff structure, client concentration). Keep it under 100 words.]"
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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic Claude API call failed: ${response.status} - ${errorText}`);
  }

  const payload = await response.json();
  const rawContent = payload.content?.[0]?.text || "";

  if (!rawContent) {
    throw new Error("No brief content returned from Anthropic Claude API.");
  }

  try {
    let cleanJsonStr = rawContent.trim();
    if (cleanJsonStr.startsWith("```")) {
      cleanJsonStr = cleanJsonStr.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsed: any = JSON.parse(cleanJsonStr);

    // Validate the scores match the schema metrics
    const validatedScores: Record<string, PostcallMetricScore> = {};
    for (const m of schema.metrics) {
      const metricScore = parsed.scores?.[m.id] || { score: 5, explanation: "No AI explanation provided." };
      validatedScores[m.id] = {
        score: typeof metricScore.score === "number" ? Math.min(10, Math.max(1, Math.round(metricScore.score))) : 5,
        explanation: metricScore.explanation || "No AI explanation provided."
      };
    }

    const summaryFallback = [
      parsed.strategicAlignment ? `**DEAL SUMMARY & STRATEGIC ALIGNMENT**\n${parsed.strategicAlignment}` : "",
      parsed.financialReality ? `**FINANCIALS & VALUATION REALITY**\n${parsed.financialReality}` : "",
      parsed.redFlags ? `**OPERATIONAL RED FLAGS & TRANSITION RISKS**\n${parsed.redFlags}` : "",
      parsed.dealStructure ? `**PROPOSED DEAL STRUCTURE**\n${parsed.dealStructure}` : "",
      parsed.nextSteps ? `**CRITICAL NEXT STEPS**\n${parsed.nextSteps}` : ""
    ].filter(Boolean).join("\n\n");

    return {
      strategicAlignment: parsed.strategicAlignment || "",
      financialReality: parsed.financialReality || "",
      redFlags: parsed.redFlags || "",
      dealStructure: parsed.dealStructure || "",
      nextSteps: parsed.nextSteps || "",
      summary: parsed.summary || summaryFallback,
      scores: validatedScores,
      followUpEmail: parsed.followUpEmail || "Dear team, the follow-up email draft is pending."
    };
  } catch (err: any) {
    console.error("[Claude Parsing Error for Postcall Brief] Raw response:", rawContent);
    throw new Error(`Failed to parse post-call AI response into structured JSON: ${err.message}`);
  }
}

export async function generatePortfolioBriefingWithAI(
  metrics: any[],
  healths: any[],
  alerts: any[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not configured.");
  }

  const systemPrompt = `You are a senior portfolio monitoring director at Aysan Capital Partners.
Provide an institutional portfolio intelligence briefing. Keep the entire briefing under 150 words total, structured strictly for fast reading:

1. Executive Summary: 1 short sentence on overall health and alert counts.
2. Underperforming Assets: 2-3 short bullets calling out specific stressed companies and their metrics (e.g., Clear Water DSCR, headcount drops).
3. Recommended Actions: 2-3 concrete operational next steps in short bullets.

CRITICAL RULE:
- Do NOT invent metrics/scores. Rely ONLY on the provided numbers and alerts.
- Do NOT output preamble, titles, or conversational filler. Respond directly with the briefing text.`;

  const userContent = `Here is the portfolio state:
Health Scores:
${healths.map(h => `- ${h.companyName}: Score ${h.portfolioScore}/100, Risk Level: ${h.riskLevel}, Trend: ${h.trendSummary}`).join("\n")}

Active Alerts:
${alerts.length === 0 ? "No active alerts." : alerts.map(a => `- [${a.severity.toUpperCase()}] ${a.companyName}: ${a.explanation}`).join("\n")}

Latest Metrics:
${metrics.map(m => `- ${m.companyName} (${m.reportingPeriod}): Rev: £${m.revenue.toLocaleString()}, EBITDA: £${m.ebitda.toLocaleString()}, DSCR: ${m.dscr}x, Lev: ${m.leverage}x, Headcount: ${m.headcount}`).join("\n")}
`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic Claude API call failed: ${response.status} - ${errorText}`);
  }

  const payload = await response.json();
  const rawContent = payload.content?.[0]?.text || "";
  return rawContent.trim();
}

