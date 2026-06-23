export interface ACPSnario {
  id: string;
  name: string;
  description: string;
  lead: string;
  secondSeat: string | null;
  openingScript?: string;
  holdingScript: string;
  hardGuardrails: string[];
}

export const ACP_HARD_GUARDRAILS = [
  "No cash-at-completion figure",
  "No earn-out (any label)",
  "VLN and deferred consideration kept distinct",
  "No valuation anchor",
  "No lender names",
  "No YOFY / automation mention",
  "Six facts captured before the call ends"
];

export const ACP_HOLDING_SCRIPT = "That's exactly the right question, and I want to give you a straight answer rather than a number off the top of my head. The way we work, the structure and the figure come from Ayo and our financial side together, against the actual accounts — so I'd be doing you a disservice if I anchored anything today. What I can promise is a considered response from the partnership, quickly, once I've taken back what we've covered. Is there anything you'd specifically want us to address when we come back to you?";

export const ACP_SCENARIOS: Record<string, ACPSnario> = {
  primary: {
    id: "primary",
    name: "Primary",
    description: "Standard Ayo + Prince two-hander",
    lead: "ayo",
    secondSeat: "prince",
    holdingScript: ACP_HOLDING_SCRIPT,
    hardGuardrails: ACP_HARD_GUARDRAILS
  },
  ayo_absent: {
    id: "ayo_absent",
    name: "Ayo-Absent (Partner-Down)",
    description: "Prince leads all phases; Dallience captures. No non-partner runs a seller call as lead.",
    lead: "prince",
    secondSeat: "dallience",
    openingScript: "Thanks for making the time. I'm Prince, I lead origination and commercial at Aysan Capital. Ayo, our Managing Partner, sends his apologies — he's tied up today, and rather than push you back a week, I wanted to keep our conversation moving. Dallience is with me to keep a clean note so nothing gets lost.\n\nA bit about us so you know who you're talking to. We're a permanent holding company. We buy good businesses in our sector and we hold them — we're not here to strip anything down or flip it on. We're selective, so today is as much us understanding whether this is the right fit as the other way round. I'd like to understand your business and what matters to you, and you should feel free to ask us anything. The structure and the numbers are Ayo's seat, and he and I take those together — so today I'm not here with an offer, I'm here to understand. Does that work for you?",
    holdingScript: ACP_HOLDING_SCRIPT,
    hardGuardrails: ACP_HARD_GUARDRAILS
  },
  prince_absent: {
    id: "prince_absent",
    name: "Prince-Absent (Partner-Down)",
    description: "Ayo leads all phases; Dallience captures. Revenue-quality depth flagged for follow-up.",
    lead: "ayo",
    secondSeat: "dallience",
    holdingScript: ACP_HOLDING_SCRIPT,
    hardGuardrails: ACP_HARD_GUARDRAILS
  }
};
