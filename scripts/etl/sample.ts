/** Dump one record from each of several tables to inspect field value shapes. */
import { fetchAllRecords } from "./_client.js";

const TABLES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["Deal_Inbox", "Review_Queue", "Active_Pipeline", "Archive", "Documents", "Lender_Deal_Assignments"];

async function main() {
  for (const t of TABLES) {
    const recs = await fetchAllRecords(t);
    console.log(`\n===== ${t} (first record of ${recs.length}) =====`);
    console.log(JSON.stringify(recs[0], null, 2));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
