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
  businessProfile: string;
  openingAngle: string;
  questionsToAsk: string[];
  callScript?: string;
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

  const systemPrompt = `You are a senior investment associate at Aysan Capital Partners.
Your job is to prepare a Pre-call Intelligence Brief and Call Script for Prince.

Create a precall brief and call script for Prince (alone) for this meeting tomorrow 18/06/26 and use the OSINT framework and prompt library to ensure the output is optimized.

You MUST respond ONLY with a valid JSON object. Do not output any preamble, markdown formatting block fences (like \`\`\`json), or conversational filler. The output must be pure, parsable JSON matching this schema exactly:

{
  "businessProfile": "A concise paragraph summarizing the company, sector, location, financials (Turnover, EBITDA, Asking Price, EV multiple if available), and transition risks (e.g. TUPE or key contracts). Make it specific to the deal details provided.",
  "openingAngle": "Actionable advice on how Prince should open the call and position our approach (e.g., focus on legacy, trust, continuity, or deal structuring).",
  "questionsToAsk": [
    "Specific strategic question 1",
    "Specific strategic question 2",
    "Specific strategic question 3"
  ],
  "callScript": "A complete, word-for-word call script written for Prince (alone) to conduct this meeting tomorrow 18/06/26. The script should use the OSINT framework to build rapport, gather intelligence, and direct the conversation naturally."
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

Create a precall brief and call script for Prince (alone) for this meeting tomorrow 18/06/26 and use the OSINT framework and prompt library to ensure the output is optimized.

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
      max_tokens: 4000,
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

    const parsed: PrecallBriefResult = JSON.parse(cleanJsonStr);
    return {
      businessProfile: parsed.businessProfile || "",
      openingAngle: parsed.openingAngle || "",
      questionsToAsk: Array.isArray(parsed.questionsToAsk) ? parsed.questionsToAsk : [],
      callScript: parsed.callScript || ""
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
    ${schema.metrics.map(m => `"${m.id}": { "score": 8, "explanation": "..." }`).join(",\n    ")}
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

    const parsed: PostcallBriefResult = JSON.parse(cleanJsonStr);

    // Validate the scores match the schema metrics
    const validatedScores: Record<string, PostcallMetricScore> = {};
    for (const m of schema.metrics) {
      const metricScore = parsed.scores?.[m.id] || { score: 5, explanation: "No AI explanation provided." };
      validatedScores[m.id] = {
        score: typeof metricScore.score === "number" ? Math.min(10, Math.max(1, Math.round(metricScore.score))) : 5,
        explanation: metricScore.explanation || "No AI explanation provided."
      };
    }

    return {
      summary: parsed.summary || "Discovery call complete. Key details analyzed.",
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

