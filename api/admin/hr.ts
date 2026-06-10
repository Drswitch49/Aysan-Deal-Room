import { airtableFetch, TABLES } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

// Mock data fallbacks if tables are not found
const MOCK_TEAM = [
  {
    initials: "AO",
    name: "Ayo Oyesanya",
    role: "Managing Partner - ACP GP / VDR",
    accessLevel: "FULL ACCESS",
    avatarTheme: "blue",
    order: 1
  },
  {
    initials: "PM",
    name: "Prince Molo",
    role: "Deal Sourcing - BDM",
    accessLevel: "READ ACCESS",
    avatarTheme: "green",
    order: 2
  },
  {
    initials: "DC",
    name: "David Chilton",
    role: "Finance - Underwriting",
    accessLevel: "FINANCE ACCESS",
    avatarTheme: "amber",
    order: 3
  },
  {
    initials: "C",
    name: "Claude",
    role: "Deal Ops - Ref: Clear",
    accessLevel: "OPS ACCESS",
    avatarTheme: "purple",
    order: 4
  },
  {
    initials: "D",
    name: "Deliveree",
    role: "Ops & Data",
    accessLevel: "ASSISTANT",
    avatarTheme: "slate",
    order: 5
  }
];

const MOCK_HIRES = [
  {
    role: "CEO",
    company: "Clear Water Cleaning Services",
    status: "Status: candidates search · First post clear · Target 60 days",
    accentColor: "amber"
  },
  {
    role: "Operations Manager",
    company: "MGL (contingent on close)",
    status: "Status: scoping · Depends on deal outcome",
    accentColor: "blue"
  }
];

const MOCK_STAKEHOLDERS = [
  {
    name: "Lee Coutanche",
    association: "Moorfields Commercial Finance",
    description: "Lender · active relationship · on: 4 deals active",
    accentColor: "blue"
  },
  {
    name: "Gillie Edwards",
    association: "KBS Group broker",
    description: "Broker · Deal teaser · 3 referrals active",
    accentColor: "green"
  },
  {
    name: "Navi",
    association: "Marketing contractor",
    description: "Marketing · Website revamp · Current",
    accentColor: "green"
  },
  {
    name: "Torsten Edwards",
    association: "Tech contractor",
    description: "Developer · Portal development · on: all projects",
    accentColor: "amber"
  }
];

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    await authenticateAdmin(req);

    // 2. Fetch datasets in parallel, catching 404s/TABLE_NOT_FOUND to use mockups
    const [teamRes, hiresRes, stakeholdersRes] = await Promise.allSettled([
      airtableFetch(TABLES.TEAM),
      airtableFetch(TABLES.HIRING),
      airtableFetch(TABLES.STAKEHOLDERS)
    ]);

    let team = MOCK_TEAM;
    if (teamRes.status === "fulfilled" && teamRes.value && teamRes.value.records) {
      const mapped = teamRes.value.records.map((rec: any) => ({
        id: rec.id,
        initials: rec.fields["Initials"] || "",
        name: rec.fields["Name"] || "",
        role: rec.fields["Role"] || "",
        accessLevel: rec.fields["Access_Level"] || "READ ACCESS",
        avatarTheme: rec.fields["Avatar_Theme"] || "blue",
        order: rec.fields["Order"] !== undefined ? Number(rec.fields["Order"]) : 99
      }));
      mapped.sort((a: any, b: any) => a.order - b.order);
      team = mapped;
    } else if (teamRes.status === "rejected") {
      const err = teamRes.reason;
      if (err.status !== 404 && err.type !== "TABLE_NOT_FOUND") {
        console.error("Airtable Team Fetch failed with non-404 error:", err);
      }
    }

    let hires = MOCK_HIRES;
    if (hiresRes.status === "fulfilled" && hiresRes.value && hiresRes.value.records) {
      hires = hiresRes.value.records.map((rec: any) => ({
        id: rec.id,
        role: rec.fields["Role"] || "",
        company: rec.fields["Company"] || "",
        status: rec.fields["Status_Text"] || "",
        accentColor: rec.fields["Accent_Color"] || "amber"
      }));
    } else if (hiresRes.status === "rejected") {
      const err = hiresRes.reason;
      if (err.status !== 404 && err.type !== "TABLE_NOT_FOUND") {
        console.error("Airtable Hiring Briefs Fetch failed with non-404 error:", err);
      }
    }

    let stakeholders = MOCK_STAKEHOLDERS;
    if (stakeholdersRes.status === "fulfilled" && stakeholdersRes.value && stakeholdersRes.value.records) {
      stakeholders = stakeholdersRes.value.records.map((rec: any) => ({
        id: rec.id,
        name: rec.fields["Name"] || "",
        association: rec.fields["Association"] || "",
        description: rec.fields["Description"] || "",
        accentColor: rec.fields["Accent_Color"] || "blue"
      }));
    } else if (stakeholdersRes.status === "rejected") {
      const err = stakeholdersRes.reason;
      if (err.status !== 404 && err.type !== "TABLE_NOT_FOUND") {
        console.error("Airtable Stakeholders Fetch failed with non-404 error:", err);
      }
    }

    return res.status(200).json({ team, hires, stakeholders });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
