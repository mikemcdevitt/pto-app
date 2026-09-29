/**
 * Populates parent_students from the existing family_parents /
 * family_students links: for every family, links every parent in that
 * family to every student in that family. That's the same "these people
 * are all directly related" assumption family_parents/family_students
 * already encode (see the comment on the `families` table in schema.ts) --
 * this just makes it explicit at the parent<->student level, which is what
 * the parent dashboard, the admin Parent detail page, and the
 * grade-participation calculation all actually query.
 *
 * Neither import-staged-families.ts nor its predecessor ever wrote to
 * parent_students -- every bulk-imported family is missing these links
 * entirely (family-level links only). Run this once to backfill, and again
 * after any future bulk import until import-staged-families.ts is updated
 * to write these directly.
 *
 * Safe to re-run: uses onConflictDoNothing, so links already on file
 * (e.g. created by hand via the admin Add/Edit Parent pages) are left
 * alone, never overwritten or duplicated.
 *
 * Defaults to DRY RUN -- prints what it would do without touching the
 * database. Pass --commit to actually write.
 *
 * Usage:
 *   npx tsx scripts/sync-parent-students.ts            # dry run
 *   npx tsx scripts/sync-parent-students.ts --commit   # actually writes
 */

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db");
  const { familyParents, familyStudents, parentStudents } = await import("../src/db/schema");

  const commit = process.argv.includes("--commit");

  const parentLinks = await db.select().from(familyParents);
  const studentLinks = await db.select().from(familyStudents);
  const existing = await db.select().from(parentStudents);
  const existingSet = new Set(existing.map((e) => `${e.parentId}:${e.studentId}`));

  const parentsByFamily = new Map<string, string[]>();
  for (const l of parentLinks) {
    parentsByFamily.set(l.familyId, [...(parentsByFamily.get(l.familyId) ?? []), l.parentId]);
  }
  const studentsByFamily = new Map<string, string[]>();
  for (const l of studentLinks) {
    studentsByFamily.set(l.familyId, [...(studentsByFamily.get(l.familyId) ?? []), l.studentId]);
  }

  const toCreate: { parentId: string; studentId: string }[] = [];
  const allFamilyIds = new Set([...parentsByFamily.keys(), ...studentsByFamily.keys()]);
  for (const familyId of allFamilyIds) {
    const familyParentIds = parentsByFamily.get(familyId) ?? [];
    const familyStudentIds = studentsByFamily.get(familyId) ?? [];
    for (const parentId of familyParentIds) {
      for (const studentId of familyStudentIds) {
        if (!existingSet.has(`${parentId}:${studentId}`)) {
          toCreate.push({ parentId, studentId });
        }
      }
    }
  }

  console.log(
    commit
      ? "COMMIT mode -- this will write to the real database."
      : "DRY RUN -- no writes will happen. Pass --commit to actually write."
  );
  console.log(`${existing.length} parent_students link(s) already on file.`);
  console.log(`${allFamilyIds.size} families scanned, ${toCreate.length} missing link(s) to ${commit ? "create" : "would create"}.`);

  if (toCreate.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (commit) {
    const chunkSize = 500;
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      const chunk = toCreate.slice(i, i + chunkSize);
      await db.insert(parentStudents).values(chunk).onConflictDoNothing();
    }
    console.log(`Created ${toCreate.length} link(s).`);
  } else {
    console.log("Sample of what would be created (first 10):");
    for (const c of toCreate.slice(0, 10)) {
      console.log(`  ${c.parentId} <-> ${c.studentId}`);
    }
  }
}

main();
