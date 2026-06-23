/**
* Job Worker: Pre-call Brief Generation
*
* Called by QStash. Reads deal snapshot + params stored in the Airtable record,
* calls Claude, and persists the generated brief back to Airtable.
*
* Vercel Hobby: 10s total. Claude capped at 8.5s via AbortSignal.
*/

import { airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { verifyQStashRequest } from "../_utils/qstash.js";
import { updateJobStatus, failJob } from "../_utils/job-status.js";
import { ACP_PERSONAS } from "../../src/lib/acp/personas.js";
import { ACP_SCENARIOS, ACP_HARD_GUARDRAILS } from "../../src/lib/acp/scenarios.js";

const AI_TIMEOUT_MS = 8_500;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await verifyQStashRequest(req);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  const { recordId } = req.body || {};
  if (!recordId) {
    return res.status(400).json({ error: "recordId is required" });
  }

  const table = TABLES.PRECALL_BRIEFS || "Precall_Briefs";

  try {
    await updateJobStatus(table, recordId, {
      status: "processing",
      startedAt: new Date().toISOString(),
    });

    // Fetch the record — it was created with deal snapshot + params in Brief Data
    const record = await airtableFetchRecord(table, recordId);
    if (!record) {
      await failJob(table, recordId, "Pre-call brief record not found");
      return res.status(404).json({ error: "Record not found" });
    }

    const fields = record.fields as Record<string, any>;
    let jobPayload: any = {};
    try {
      jobPayload = JSON.parse(fields["Brief Data"] || "{}");
    } catch {
      await failJob(table, recordId, "Could not parse Brief Data from record");
      return res.status(422).json({ error: "Invalid Brief Data in record" });
    }

    const { dealData, selectedCallType, selectedPersonas, selectedScenario, dataSources, pastedText } = jobPayload;
    if (!dealData) {
      await failJob(table, recordId, "No dealData found in Brief Data");
      return res.status(422).json({ error: "No deal data in record" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await failJob(table, recordId, "ANTHROPIC_API_KEY not configured");
      return res.status(500).json({ error: "AI service not configured" });
    }

    const callTypeLabel =
      selectedCallType === "1st"
        ? "1st Seller Call"
        : selectedCallType === "2nd"
          ? "2nd Follow-up Call"
          : "Negotiation";

    const activePersonas = (selectedPersonas || []).map((id: string) => ACP_PERSONAS[id]).filter(Boolean);
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

    const activeScenario = selectedScenario ? ACP_SCENARIOS[selectedScenario] : null;
    const scenarioContext = activeScenario
      ? `\n\nCOVERAGE SCENARIO & CONTINGENCY PROTOCOL:\n` +
        `Scenario: ${activeScenario.name}\n` +
        `Description: ${activeScenario.description}\n` +
        `Lead: ${ACP_PERSONAS[activeScenario.lead]?.name || activeScenario.lead}\n` +
        `Second Seat: ${activeScenario.secondSeat ? (ACP_PERSONAS[activeScenario.secondSeat]?.name || activeScenario.secondSeat) : "None"}\n` +
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
- Never fabricate facts; clearly label assumptions.`;

    const userContent = `Company: ${dealData.companyName || dealData.dealRef}
Sector: ${dealData.sector} | Location: ${dealData.location}
EV: ${dealData.evAsk ? `£${dealData.evAsk}` : "TBC"}
Revenue: ${dealData.revenue ? `£${dealData.revenue}` : "TBC"}
EBITDA: ${dealData.ebitda ? `£${dealData.ebitda}` : "TBC"}
EV Multiple: ${dealData.multiplier || "TBC"}
Call Type: ${callTypeLabel}
Selected Participants: ${activePersonas.map((p: any) => p.name).join(", ") || "None"}
Sources: ${(dataSources || []).join(", ")}
${pastedText ? `\nIM Text:\n${pastedText.substring(0, 3_000)}` : ""}`;

    let briefContent: any;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 3500,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Claude API ${response.status}: ${await response.text()}`);
      }

      const claudePayload = await response.json();
      let raw = claudePayload.content?.[0]?.text || "";
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      }
      const parsed = JSON.parse(raw);
      briefContent = {
        executiveDealSnapshot: parsed.executiveDealSnapshot || "",
        callObjectives: parsed.callObjectives || "",
        criticalUnknowns: Array.isArray(parsed.criticalUnknowns) ? parsed.criticalUnknowns : [],
        dealKillers: Array.isArray(parsed.dealKillers) ? parsed.dealKillers : [],
        osintIntelligence: parsed.osintIntelligence || "",
        financialIntelligence: parsed.financialIntelligence || "",
        sellerIntelligence: parsed.sellerIntelligence || "",
        teamDeploymentPlan: Array.isArray(parsed.teamDeploymentPlan) ? parsed.teamDeploymentPlan : [],
        participantResponsibilities: parsed.participantResponsibilities || "",
        callPhaseOwnership: Array.isArray(parsed.callPhaseOwnership) ? parsed.callPhaseOwnership : [],
        participantQuestionBank: Array.isArray(parsed.participantQuestionBank) ? parsed.participantQuestionBank : [],
        internalWatchouts: Array.isArray(parsed.internalWatchouts) ? parsed.internalWatchouts : [],
        partnerDownCoverage: parsed.partnerDownCoverage || "",
        callStrategy: parsed.callStrategy || "",
        callScript: parsed.callScript || "",
        recommendedNextActions: Array.isArray(parsed.recommendedNextActions) ? parsed.recommendedNextActions : [],
      };
    } catch (err: any) {
      await failJob(table, recordId, `Claude call failed: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }

    // Update record with generated brief + completed status
    const updatedPayload = {
      ...briefContent,
      dealData,
      selectedPersonas: selectedPersonas || ["ayo", "prince"],
      selectedScenario: selectedScenario || "primary",
      selectedCallType: selectedCallType || "1st",
      dataSources: dataSources || {},
      aiAnswers: jobPayload.aiAnswers || [],
    };

    await airtableUpdate(table, recordId, {
      "Brief Data": JSON.stringify(updatedPayload),
      Processing_Status: "completed",
      Processed_At: new Date().toISOString(),
      Processing_Error: "",
    });

    console.log(`[Pre-call Brief] ✓ ${recordId}`);

    return res.status(200).json({ success: true, recordId, ...briefContent });
  } catch (err: any) {
    await failJob(table, recordId, err);
    return res.status(500).json({ error: err.message || "Worker failed" });
  }
}
