import { config } from "dotenv";
config();
import { airtableFetchAll } from "./api/_services/airtable";

async function run() {
  const data = await airtableFetchAll("Deal_Inbox");
  if (data.records && data.records.length > 0) {
    const fields = data.records[0].fields;
    console.log("Keys in Deal Inbox:", Object.keys(fields));
    console.log("Sample fields:", JSON.stringify(fields, null, 2));
  } else {
    console.log("No records found.");
  }
}

run().catch(console.error);
