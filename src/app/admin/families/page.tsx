import { db } from "@/db";
import { families, familyParents, familyStudents, parents, students } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import FamiliesList from "./FamiliesList";
import { requireAdminPage } from "@/lib/require-admin";

// Always hit the database on request; this route has no dynamic
// function calls (no auth()/cookies()/searchParams), so Next.js would
// otherwise be free to statically prerender it once and keep serving
// that snapshot until the next deploy -- meaning a newly linked family
// wouldn't show up here without a redeploy.
export const dynamic = "force-dynamic";

export default async function FamiliesPage() {
  await requireAdminPage();
  const [allFamilies, parentLinks, studentLinks] = await Promise.all([
    db.select({ id: families.id, name: families.name }).from(families),
    db
      .select({
        familyId: familyParents.familyId,
        parentId: parents.id,
        firstName: parents.firstName,
        lastName: parents.lastName,
        email: parents.email,
      })
      .from(familyParents)
      .innerJoin(parents, eq(parents.id, familyParents.parentId)),
    db
      .select({
        familyId: familyStudents.familyId,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(familyStudents)
      .innerJoin(students, eq(students.id, familyStudents.studentId)),
  ]);

  const nameCompare = (a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);

  const parentsByFamily = new Map<string, typeof parentLinks>();
  for (const p of parentLinks) {
    if (!parentsByFamily.has(p.familyId)) parentsByFamily.set(p.familyId, []);
    parentsByFamily.get(p.familyId)!.push(p);
  }
  const studentsByFamily = new Map<string, typeof studentLinks>();
  for (const s of studentLinks) {
    if (!studentsByFamily.has(s.familyId)) studentsByFamily.set(s.familyId, []);
    studentsByFamily.get(s.familyId)!.push(s);
  }

  const familiesWithMembers = allFamilies.map((f) => ({
    id: f.id,
    name: f.name,
    parents: (parentsByFamily.get(f.id) ?? []).slice().sort(nameCompare),
    students: (studentsByFamily.get(f.id) ?? []).slice().sort(nameCompare),
  }));

  // Default sort: by the last (then first) name of the family's
  // eldest-alphabetically child -- families with no child on file sort
  // to the end, by parent name instead, so they're still visible rather
  // than hidden.
  familiesWithMembers.sort((a, b) => {
    const aKey = a.students[0]
      ? `0|${a.students[0].lastName}|${a.students[0].firstName}`
      : `1|${a.parents[0]?.lastName ?? ""}|${a.parents[0]?.firstName ?? ""}`;
    const bKey = b.students[0]
      ? `0|${b.students[0].lastName}|${b.students[0].firstName}`
      : `1|${b.parents[0]?.lastName ?? ""}|${b.parents[0]?.firstName ?? ""}`;
    return aKey.localeCompare(bKey);
  });

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Families</h1>
        <div className="flex gap-2">
          <Link href="/admin/families/bulk-update" className="px-4 py-2 border rounded">
            Bulk Update
          </Link>
        </div>
      </div>
      <FamiliesList families={familiesWithMembers} />
    </div>
  );
}
