import { db } from "@/db";
import { schoolYears } from "@/db/schema";
import { desc } from "drizzle-orm";
import BulkUpdateForm from "./BulkUpdateForm";

// Always hit the database on request; this route has no dynamic
// function calls (no auth()/cookies()/searchParams), so Next.js would
// otherwise be free to statically prerender it once and keep serving
// that snapshot until the next deploy -- meaning a newly added school
// year wouldn't show up here without a redeploy.
export const dynamic = "force-dynamic";

export default async function BulkUpdatePage() {
  const years = await db.select().from(schoolYears).orderBy(desc(schoolYears.sortYear));

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">Bulk Update Students</h1>
      <p className="text-gray-600 mb-4">
        Paste rows copied from Excel, or load a CSV file -- either way, nothing is uploaded or
        saved anywhere until you review the results below and apply them. Expected columns, in
        order: First Name, Last Name, Grade, Homeroom (classroom abbreviation, e.g. &quot;2A&quot;).
      </p>
      <BulkUpdateForm schoolYears={years} />
    </div>
  );
}
