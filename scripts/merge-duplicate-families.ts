/**
 * Merges duplicate `families` rows created by repeated import runs (no
 * family-level dedup existed before this script) back down to one row per
 * real household, and along the way resolves the `students` row
 * duplicates that arise from the same cause (a name-match miss on a
 * repeat import creating a second row for the same real kid).
 *
 * Families are grouped by shared membership: two families rows are
 * treated as the same household if they share at least one parent or at
 * least one student (transitively, via a union-find over family_parents /
 * family_students). Within a group, students who share a normalized full
 * name are further merged into one row -- safe here because group
 * membership (a shared parent) already establishes they're the same real
 * family, unlike a bare global name-match across the whole table.
 *
 * For each group: picks a survivor family row, makes sure it's linked to
 * every parent and every (deduped) student in the group, deletes the
 * other family rows in the group (their family_parents/family_students
 * rows go with them via ON DELETE CASCADE). For any two students merged
 * into one, moves/dedupes their student_classrooms links and fills in a
 * null cohortYear from the merged-away row before deleting it. Also
 * deletes families with zero parents and zero students (orphaned rows
 * left behind by a partial import failure -- see import-staged-families.ts's
 * non-atomic caveat).
 *
 * A genuine conflict inside a group -- two same-named students with
 * different non-null cohort years, or different classrooms for the same
 * school year -- leaves that whole group alone and reports it instead of
 * guessing. Resolve by hand (Edit Student admin page) and re-run.
 *
 * Defaults to DRY RUN -- prints what it would do without touching the
 * database. Pass --commit to actually merge/delete.
 *
 * Usage:
 *   npx tsx scripts/merge-duplicate-families.ts            # dry run
 *   npx tsx scripts/merge-duplicate-families.ts --commit    # actually merges
 */

import { config } from "dotenv";
config({ path: ".env.local" });

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

async function main() {
  const { db } = await import("../src/db");
  const { families, familyParents, familyStudents, students, studentClassrooms } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const commit = process.argv.includes("--commit");

  const allFamilies = await db.select().from(families);
  const allFamilyParents = await db.select().from(familyParents);
  const allFamilyStudents = await db.select().from(familyStudents);
  const allStudents = await db.select().from(students);
  const allClassroomLinks = await db.select().from(studentClassrooms);

  console.log(
    commit
      ? "COMMIT mode -- this will merge and delete rows in the real database."
      : "DRY RUN -- no writes will happen. Pass --commit to actually merge."
  );
  console.log(
    `${allFamilies.length} families, ${allFamilyParents.length} family_parents, ${allFamilyStudents.length} family_students.`
  );

  const parentsByFamily = new Map<string, string[]>();
  for (const l of allFamilyParents) parentsByFamily.set(l.familyId, [...(parentsByFamily.get(l.familyId) ?? []), l.parentId]);
  const studentsByFamily = new Map<string, string[]>();
  for (const l of allFamilyStudents) studentsByFamily.set(l.familyId, [...(studentsByFamily.get(l.familyId) ?? []), l.studentId]);

  const uf = new UnionFind();
  for (const f of allFamilies) uf.find(f.id);

  const familiesByParent = new Map<string, string[]>();
  for (const l of allFamilyParents) familiesByParent.set(l.parentId, [...(familiesByParent.get(l.parentId) ?? []), l.familyId]);
  const familiesByStudent = new Map<string, string[]>();
  for (const l of allFamilyStudents) familiesByStudent.set(l.studentId, [...(familiesByStudent.get(l.studentId) ?? []), l.familyId]);

  for (const familyIds of familiesByParent.values()) {
    for (let i = 1; i < familyIds.length; i++) uf.union(familyIds[0], familyIds[i]);
  }
  for (const familyIds of familiesByStudent.values()) {
    for (let i = 1; i < familyIds.length; i++) uf.union(familyIds[0], familyIds[i]);
  }

  const groups = new Map<string, typeof allFamilies>();
  for (const f of allFamilies) {
    const root = uf.find(f.id);
    groups.set(root, [...(groups.get(root) ?? []), f]);
  }

  const dupeGroups = [...groups.values()].filter((g) => g.length > 1);
  const emptyOrphans = allFamilies.filter((f) => {
    const g = groups.get(uf.find(f.id))!;
    return (
      g.length === 1 &&
      (parentsByFamily.get(f.id) ?? []).length === 0 &&
      (studentsByFamily.get(f.id) ?? []).length === 0
    );
  });

  console.log(`${dupeGroups.length} household group(s) span more than one families row.`);
  console.log(
    `${emptyOrphans.length} completely empty family row(s) (no parents, no students) -- ${commit ? "deleting" : "would delete"} these outright.`
  );

  const studentById = new Map(allStudents.map((s) => [s.id, s]));
  const classroomLinksByStudent = new Map<string, typeof allClassroomLinks>();
  for (const l of allClassroomLinks) {
    classroomLinksByStudent.set(l.studentId, [...(classroomLinksByStudent.get(l.studentId) ?? []), l]);
  }

  let familiesMerged = 0;
  let familiesDeleted = 0;
  let studentsMerged = 0;
  let groupsSkipped = 0;

  for (const group of dupeGroups.sort((a, b) => a[0].id.localeCompare(b[0].id))) {
    const familyIds = group.map((f) => f.id);
    const label = group.find((f) => f.name)?.name ?? "(unnamed)";
    console.log(`\n=== "${label}" -- ${group.length} families rows: [${familyIds.join(", ")}] ===`);

    const memberParentIds = [...new Set(familyIds.flatMap((id) => parentsByFamily.get(id) ?? []))];
    const memberStudentIds = [...new Set(familyIds.flatMap((id) => studentsByFamily.get(id) ?? []))];

    const studentNameGroups = new Map<string, string[]>();
    for (const sid of memberStudentIds) {
      const s = studentById.get(sid);
      if (!s) continue;
      const key = normName(`${s.firstName} ${s.lastName}`);
      studentNameGroups.set(key, [...(studentNameGroups.get(key) ?? []), sid]);
    }

    const studentIdRemap = new Map<string, string>();
    let conflict = false;

    for (const [nameKey, ids] of studentNameGroups) {
      if (ids.length <= 1) continue;
      const rows = ids.map((id) => studentById.get(id)!);
      const sorted = [...rows].sort((a, b) => {
        const aRooms = (classroomLinksByStudent.get(a.id) ?? []).length;
        const bRooms = (classroomLinksByStudent.get(b.id) ?? []).length;
        if (aRooms !== bRooms) return bRooms - aRooms;
        return a.id.localeCompare(b.id);
      });
      const [survivor, ...losers] = sorted;
      for (const loser of losers) {
        if (survivor.cohortYear != null && loser.cohortYear != null && survivor.cohortYear !== loser.cohortYear) {
          console.log(
            `  CONFLICT: "${nameKey}" -- ${survivor.id} (cohortYear ${survivor.cohortYear}) vs ${loser.id} (cohortYear ${loser.cohortYear}) -- skipping this whole group, resolve by hand.`
          );
          conflict = true;
          continue;
        }
        const survivorRooms = classroomLinksByStudent.get(survivor.id) ?? [];
        const loserRooms = classroomLinksByStudent.get(loser.id) ?? [];
        const clash = loserRooms.find((lr) =>
          survivorRooms.some((sr) => sr.schoolYearId === lr.schoolYearId && sr.classroomId !== lr.classroomId)
        );
        if (clash) {
          console.log(
            `  CONFLICT: "${nameKey}" -- ${survivor.id} and ${loser.id} have different classrooms for the same school year -- skipping this whole group, resolve by hand.`
          );
          conflict = true;
          continue;
        }
        studentIdRemap.set(loser.id, survivor.id);
      }
    }

    if (conflict) {
      groupsSkipped++;
      continue;
    }

    const canonicalStudentIds = [...new Set(memberStudentIds.map((id) => studentIdRemap.get(id) ?? id))];

    const survivorFamily = [...group].sort((a, b) => {
      const aName = a.name ? 1 : 0;
      const bName = b.name ? 1 : 0;
      if (aName !== bName) return bName - aName;
      return a.id.localeCompare(b.id);
    })[0];
    const loserFamilies = group.filter((f) => f.id !== survivorFamily.id);

    console.log(`  survivor family: ${survivorFamily.id} (name: ${survivorFamily.name ?? "none"})`);
    console.log(
      `  members: ${memberParentIds.length} parent(s), ${canonicalStudentIds.length} student(s) after merging duplicates`
    );
    for (const [loserId, survivorId] of studentIdRemap) {
      console.log(`  merge student ${loserId} -> ${survivorId}`);
    }
    for (const lf of loserFamilies) {
      console.log(`  delete redundant family row ${lf.id}`);
    }

    if (commit) {
      const survivorParentIds = new Set(parentsByFamily.get(survivorFamily.id) ?? []);
      const missingParents = memberParentIds.filter((pid) => !survivorParentIds.has(pid));
      if (missingParents.length > 0) {
        await db.insert(familyParents).values(missingParents.map((parentId) => ({ familyId: survivorFamily.id, parentId })));
      }
      const survivorStudentIds = new Set(studentsByFamily.get(survivorFamily.id) ?? []);
      const missingStudents = canonicalStudentIds.filter((sid) => !survivorStudentIds.has(sid));
      if (missingStudents.length > 0) {
        await db.insert(familyStudents).values(missingStudents.map((studentId) => ({ familyId: survivorFamily.id, studentId })));
      }
      for (const [loserId, survivorId] of studentIdRemap) {
        const loser = studentById.get(loserId)!;
        const survivor = studentById.get(survivorId)!;
        const survivorRooms = classroomLinksByStudent.get(survivorId) ?? [];
        const loserRooms = classroomLinksByStudent.get(loserId) ?? [];
        for (const lr of loserRooms) {
          const already = survivorRooms.some((sr) => sr.schoolYearId === lr.schoolYearId);
          if (!already) {
            await db.update(studentClassrooms).set({ studentId: survivorId }).where(eq(studentClassrooms.id, lr.id));
          }
        }
        if (survivor.cohortYear == null && loser.cohortYear != null) {
          await db.update(students).set({ cohortYear: loser.cohortYear }).where(eq(students.id, survivorId));
        }
        await db.delete(students).where(eq(students.id, loserId));
      }
      for (const lf of loserFamilies) {
        await db.delete(families).where(eq(families.id, lf.id));
      }
    }

    familiesMerged++;
    familiesDeleted += loserFamilies.length;
    studentsMerged += studentIdRemap.size;
  }

  if (commit && emptyOrphans.length > 0) {
    for (const f of emptyOrphans) {
      await db.delete(families).where(eq(families.id, f.id));
    }
  }

  console.log(
    `\n${commit ? "Merged" : "Would merge"} ${familiesMerged} household group(s), ${commit ? "deleted" : "would delete"} ${familiesDeleted} redundant families row(s), ${commit ? "merged" : "would merge"} ${studentsMerged} duplicate student row(s).`
  );
  console.log(`${commit ? "Deleted" : "Would delete"} ${emptyOrphans.length} empty orphan family row(s).`);
  console.log(`Skipped ${groupsSkipped} group(s) with a conflict -- resolve those by hand and re-run.`);
}

main();
