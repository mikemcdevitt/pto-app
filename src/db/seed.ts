import { db } from "./index";
import { schoolYears } from "./schema";

async function seed() {
  await db.insert(schoolYears).values([
    { label: "2025-2026", sortYear: 2026 },
    { label: "2026-2027", sortYear: 2027 },
  ]);
  console.log("Seeded school years.");
}

seed().then(() => process.exit(0));