import { airtableFetch, TABLES, getAssignmentFields } from "../_utils/airtable.js";
import { authenticateAdmin } from "./lenders.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    await authenticateAdmin(req);

    // 2. Fetch all required tables in parallel to validate schema and assemble data
    const requiredTables = {
      team: TABLES.TEAM,
      hiring: TABLES.HIRING,
      stakeholders: TABLES.STAKEHOLDERS,
      lenders: TABLES.LENDERS,
      assignments: TABLES.ASSIGNMENTS,
      pipeline: TABLES.PIPELINE
    };

    const keys = Object.keys(requiredTables) as Array<keyof typeof requiredTables>;
    const promises = keys.map(key => airtableFetch(requiredTables[key]));
    const results = await Promise.allSettled(promises);

    const missingTables: string[] = [];
    const fetchedData: Record<string, any> = {};

    results.forEach((res, index) => {
      const key = keys[index];
      const tableName = requiredTables[key];
      if (res.status === "fulfilled") {
        fetchedData[key] = res.value;
      } else {
        const err = res.reason;
        if (err.status === 404 || err.type === "TABLE_NOT_FOUND" || String(err.message).includes("not found")) {
          missingTables.push(tableName);
        } else {
          // Re-throw other critical database connectivity or rate-limiting errors
          throw err;
        }
      }
    });

    if (missingTables.length > 0) {
      return res.status(428).json({
        error: "Airtable schema setup incomplete. Missing required tables.",
        type: "SCHEMA_ERROR",
        missingTables,
        diagnostics: {
          message: `The following required table(s) were not found in your Airtable base: ${missingTables.join(", ")}. Please run the schema sync script to create them.`,
          resolution: "Run this command on your terminal to synchronize the tables: 'node scripts/sync-hr-schema.js'"
        }
      });
    }

    // 3. Process Team Members
    const teamRecords = fetchedData.team.records || [];
    const team = teamRecords.map((rec: any) => {
      const name = rec.fields["Name"] || "";
      const initials = rec.fields["Initials"] || name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) || "??";
      const role = rec.fields["Role"] || "";
      return {
        id: rec.id,
        initials,
        name,
        role,
        accessLevel: rec.fields["Access_Level"] || (role === "Admin" || role === "Managing Partner" ? "FULL ACCESS" : "WRITE ACCESS"),
        avatarTheme: rec.fields["Avatar_Theme"] || (role === "Admin" ? "purple" : role === "Managing Partner" ? "amber" : "blue"),
        order: rec.fields["Order"] !== undefined ? Number(rec.fields["Order"]) : 99
      };
    });
    team.sort((a: any, b: any) => a.order - b.order);

    // 4. Process Hiring Briefs
    const hiringRecords = fetchedData.hiring.records || [];
    const hires = hiringRecords.map((rec: any) => ({
      id: rec.id,
      role: rec.fields["Role"] || "",
      company: rec.fields["Company"] || "",
      status: rec.fields["Status_Text"] || "",
      accentColor: rec.fields["Accent_Color"] || "amber"
    }));

    // 5. Get assignment field configurations
    const { lenderIdCol, statusCol } = await getAssignmentFields();

    // 6. Process External Stakeholders (with relational intelligence)
    const stakeholderRecords = fetchedData.stakeholders.records || [];
    const lenders = fetchedData.lenders.records || [];
    const assignments = fetchedData.assignments.records || [];
    const pipeline = fetchedData.pipeline.records || [];

    const stakeholders = stakeholderRecords.map((rec: any) => {
      const id = rec.id;
      const name = (rec.fields["Name"] || "").trim();
      const association = (rec.fields["Association"] || rec.fields["Organization"] || rec.fields["Type"] || "").trim() || "External Partner";
      const staticDescription = rec.fields["Description"] || rec.fields["Notes"] || "";
      const type = rec.fields["Type"] || "";
      const accentColor = rec.fields["Accent_Color"] || (type === "Broker" ? "amber" : type === "Lawyer" ? "blue" : "green");

      let description = staticDescription;

      // Try to match with Lenders table
      const matchingLender = lenders.find((l: any) => {
        const lContact = (l.fields["Contact_Name"] || "").trim().toLowerCase();
        const lCompany = (l.fields["Company_Name"] || "").trim().toLowerCase();
        const cleanName = name.toLowerCase();
        const cleanAssoc = association.toLowerCase();

        return (lContact && cleanName.includes(lContact)) ||
               (lContact && lContact.includes(cleanName)) ||
               (lCompany && cleanAssoc.includes(lCompany)) ||
               (lCompany && lCompany.includes(cleanAssoc));
      });

      const isBroker = association.toLowerCase().includes("broker") || 
                       name.toLowerCase().includes("broker") || 
                       staticDescription.toLowerCase().includes("broker");

      if (matchingLender) {
        // Count active assignments for this lender
        const activeAssignments = assignments.filter((asg: any) => {
          const linkVal = asg.fields[lenderIdCol];
          const asgStatus = statusCol ? asg.fields[statusCol] : "Active";
          if (asgStatus !== "Active") return false;

          if (Array.isArray(linkVal)) {
            return linkVal.includes(matchingLender.id) || linkVal.includes(matchingLender.fields.Lender_ID);
          }
          return linkVal === matchingLender.id || linkVal === matchingLender.fields.Lender_ID;
        });
        description = `Lender · active relationship · on: ${activeAssignments.length} deals active`;
      } else if (isBroker) {
        // Count deals in pipeline matching broker name/association
        const brokerDeals = pipeline.filter((deal: any) => {
          const dealBroker = (
            deal.fields["Broker"] || 
            deal.fields["Broker_Name"] || 
            deal.fields["Broker Name"] || 
            ""
          ).trim().toLowerCase();

          if (!dealBroker) return false;
          const cleanName = name.toLowerCase();
          const cleanAssoc = association.toLowerCase();
          
          const dealStage = (deal.fields["Stage"] || "").toUpperCase();
          if (dealStage === "KILLED") return false;

          return dealBroker.includes(cleanName) || cleanName.includes(dealBroker) ||
                 dealBroker.includes(cleanAssoc) || cleanAssoc.includes(dealBroker);
        });
        description = `Broker · referral pipeline · ${brokerDeals.length} active referrals`;
      }

      return {
        id,
        name,
        association,
        description,
        accentColor
      };
    });

    return res.status(200).json({ team, hires, stakeholders });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}
