import fetch from "node-fetch";

const systemPrompt = `You are the ACP (Aysan Capital Partners) pre-call intelligence and vendor-call strategist.
Your job is to prepare ACP partners for a founder/vendor call on a live acquisition opportunity.

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
}`;

const userContent = "Company: Test Company\nSector: Tech\nMake up some stuff.";

async function run() {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3500,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}

run();
