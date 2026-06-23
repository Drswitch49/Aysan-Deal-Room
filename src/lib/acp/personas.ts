export interface ACPPersona {
  id: string;
  name: string;
  role: string;
  authorityLevel: string;
  workingStyle: string;
  evidence: string;
  strengths: string[];
  weaknesses: string[]; // watch-outs
  responsibilities: string[];
  bestDeployedOn: string[];
  howAIWritesForThem: string;
  callOwnership: string[];
  partnerDownRules: string[];
  escalationRules: string[];
}

export const ACP_PERSONAS: Record<string, ACPPersona> = {
  ayo: {
    id: "ayo",
    name: "Ayo",
    role: "Managing Partner",
    authorityLevel: "Ultimate Decision Maker",
    workingStyle: "Calm, credible, selective. Authority without pressure. The closer and the final gate.",
    evidence: "Former NHS Lead Clinician — operational redesign in a high-accountability environment; founder; owns lender relationships, seller commitments, and IC sign-off.",
    strengths: ["Credibility anchor", "Frames ACP as selective rather than eager", "Holds structure and discipline", "Lands the controlled close", "Reassures on legacy and permanence"],
    weaknesses: ["Single point of failure on every critical path (Bus Factor = 1)"],
    responsibilities: ["Final terms", "Valuation approval", "Key risks assessment", "Go/No-Go decision"],
    bestDeployedOn: ["Phase 1 (opening)", "Phase 6 (structure/transition)", "Phase 7 (close)", "All IC sign-off"],
    howAIWritesForThem: "Measured, precise, unhurried. Credibility through selectivity, not enthusiasm. Permanent-hold and legacy framing in his voice.",
    callOwnership: ["Opening", "Structure/Transition", "Close", "Success Criteria"],
    partnerDownRules: ["If Prince is absent, Ayo assumes all phases but revenue-quality depth is flagged for follow-up."],
    escalationRules: ["Escalate structural deal-breakers, valuation mismatches, and fatal risks to Ayo immediately."]
  },
  prince: {
    id: "prince",
    name: "Prince",
    role: "Partner",
    authorityLevel: "Lead Negotiator / Deal Quarterback",
    workingStyle: "Relationship-led, persuasive, commercially competitive, fluent with senior stakeholders. Wins the room before he wins the point.",
    evidence: "Global Team Lead, Medidata (Dassault); exceeded annual target by 138%; twice BD of the Quarter; C-level engagement across EMEA in regulated B2B.",
    strengths: ["Builds rapport fast", "Reads the room", "Draws out operational truth conversationally rather than by interrogation", "Makes a guarded founder open up", "Competitive drive to earn the relationship and close the meeting on a forward note"],
    weaknesses: ["Rapport is not deal quality", "Risk that warmth drifts into implied commitment", "Risk of under-probing hard numbers because the relationship feels good", "Capacity risk — currently spread across five mandates"],
    responsibilities: ["Lead the call", "Establish rapport", "Uncover operational truth", "Manage the flow of the meeting"],
    bestDeployedOn: ["Phase 4 (operational truth)", "Phase 5 (revenue quality)", "In a partner-down call, the entire call"],
    howAIWritesForThem: "Warm, founder-to-founder register. Frame probing questions as genuine curiosity, not a checklist. Over-weight the discipline guardrails: explicit 'hold the line on numbers, do not imply commitment, capture the six facts before you leave' reminders in bold at the top. Give him the exact words for parking a questionable add-back warmly.",
    callOwnership: ["Relationship Building", "Operational Discovery", "Revenue Quality", "Seller Motivation"],
    partnerDownRules: ["If Ayo is absent, Prince assumes call leadership for all phases. Dallience must take second seat."],
    escalationRules: ["Escalate operational red flags and seller reluctance to Prince."]
  },
  dami: {
    id: "dami",
    name: "Dami",
    role: "Principal",
    authorityLevel: "Operational & Commercial Diligence Lead",
    workingStyle: "Precise, evidence-anchored, immovable standard. The numbers tell the truth or they do not ship.",
    evidence: "Corporate Finance Consultant, KNÖLL — German Mittelstand family-business financing; MBA; lender-grade credit packaging.",
    strengths: ["Investment-grade first-pass models", "Interrogates add-backs", "Holds the DSCR sanction line under pressure"],
    weaknesses: ["Modelling load is heavy; protect his time", "Rarely on seller calls — joins only when financial depth is genuinely needed (qualification-only pre-LOI)"],
    responsibilities: ["Drill into the customer base", "Understand the product/service delivery", "Identify operational risks", "DSCR sanction"],
    bestDeployedOn: ["Underwriting", "DSCR sanction", "Lender packs", "LOI Structuring Engine"],
    howAIWritesForThem: "Spare, exact, no rhetoric. Every figure sourced. No narrative flourish.",
    callOwnership: ["Financial Discovery", "Risk Discovery"],
    partnerDownRules: ["If Dami is absent, Prince must double-click on operational risks."],
    escalationRules: ["Escalate customer churn or operational dependency issues to Dami."]
  },
  dallience: {
    id: "dallience",
    name: "Dallience",
    role: "Associate",
    authorityLevel: "Intelligence & Data Capture",
    workingStyle: "Reliable, detail-complete, disciplined. Invisible when done well, expensive when not.",
    evidence: "Runs brief and gate-log discipline.",
    strengths: ["Institutional memory", "Captures the six facts without disturbing the rapport", "Keeps the record clean"],
    weaknesses: ["Administrative load grows faster than automation", "Drafts and routes; does not decide"],
    responsibilities: ["Capture the 'Six Facts'", "Track information gaps", "Monitor for contradictory statements vs OSINT", "Post-call summary"],
    bestDeployedOn: ["Brief assembly", "The note-taking second seat on partner-down calls", "IC gate logs", "CRM hygiene"],
    howAIWritesForThem: "Structured, complete, factual. Checklists and capture templates, not prose.",
    callOwnership: ["Data Capture", "Follow-up Action Tracking"],
    partnerDownRules: ["In partner-down calls, Dallience is the standing second seat to capture facts and free the lead to build rapport."],
    escalationRules: ["Dallience will flag data discrepancies post-call."]
  },
  chante: {
    id: "chante",
    name: "Chante",
    role: "Operations",
    authorityLevel: "Operations Planning",
    workingStyle: "Methodical operations",
    evidence: "Best on 100-day plans and operator briefs.",
    strengths: ["100-day plans", "Operator briefs"],
    weaknesses: [],
    responsibilities: ["100-day planning"],
    bestDeployedOn: ["100-day plans", "Operator briefs"],
    howAIWritesForThem: "Execution-ready, continuity-first.",
    callOwnership: [],
    partnerDownRules: [],
    escalationRules: []
  },
  jeph: {
    id: "jeph",
    name: "Jeph",
    role: "Systems Engineer",
    authorityLevel: "Systems Architecture",
    workingStyle: "Systems-first, simplest-working-version",
    evidence: "Builds and deploys systems.",
    strengths: ["Engineering specs in MoSCoW"],
    weaknesses: [],
    responsibilities: ["Tooling and systems implementation"],
    bestDeployedOn: ["Engineering specs"],
    howAIWritesForThem: "Engineering specs in MoSCoW, never deal-facing prose.",
    callOwnership: [],
    partnerDownRules: [],
    escalationRules: []
  },
  nuel: {
    id: "nuel",
    name: "Nuel",
    role: "Brand & Content",
    authorityLevel: "Brand Direction",
    workingStyle: "Brand and content focused",
    evidence: "Content direction.",
    strengths: ["Voice Genome"],
    weaknesses: [],
    responsibilities: ["Brand and content generation"],
    bestDeployedOn: ["Brand and content"],
    howAIWritesForThem: "Voice Genome, first-person from Ayo's account, deal-grounded, behind the approval gate.",
    callOwnership: [],
    partnerDownRules: [],
    escalationRules: []
  }
};
