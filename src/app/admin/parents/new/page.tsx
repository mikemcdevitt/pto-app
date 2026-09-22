import { db } from "@/db";
import { students } from "@/db/schema";
import { asc } from "drizzle-orm";
import ParentForm from "../ParentForm";

// Always hit the database on request; this route has no dynamic
// function calls (no auth()/cookies()/searchParams), so Next.js would
// otherwise be free to statically prerender it once and keep serving
// that snapshot until the next deploy -- meaning new/edited parents
// or students wouldn't show up here without a redeploy.
export const dynamic = "force-dynamic";


export default async function NewParentPage() {
  const allStudents = await db.select().from(students).orderBy(asc(students.lastName), asc(students.firstName));

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Add Parent</h1>
      <ParentForm allStudents={allStudents} />
    </div>
  );
}