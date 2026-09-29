/**
 * Reads a staged-family JSON file (the output of stage-family-import.ts,
 * after you've reviewed and cleaned it up) and actually writes it into the
 * real Neon database: parents, students, families, family_parents,
 * family_students, and (new/matched) student_classrooms.
 *
 * Defaults to a DRY RUN -- prints exactly what it would insert/link/update
 * without touching the database. Pass --commit to actually write.
 *
 * Rules:
 * - "blocked" parents and "ambiguous" students are always skipped -- there's
 *   nothing safe to do with them automatically.
 * - "matched" (existing) parents are NEVER modified, only linked into their
 *   family. If you noticed a nameMismatch while reviewing the staged file,
 *   fix that record by hand afterward via the Edit Parent admin page.
 * - "matched" (existing) STUDENTS are also only linked by default, but two
 *   fields ARE updated when the staged file says they've changed:
 *     - cohortYear is set to proposedCohortYear whenever it differs from
 *       what's currently on file (this is what stage-family-import.ts's
 *       `cohortMismatch` flags).
 *     - their classroom for the staged school year is linked/updated to
 *       match `classroom` whenever it differs from the classroom currently
 *       on file for that year (`classroomMismatch`).
 *   This means, unlike parents, a hand-edit to a matched student's
 *   `proposedCohortYear` or `classroom` in the staged JSON DOES change what
 *   gets written -- review those fields the same way you'd review a "new"
 *   record. The actual write decision is re-derived from the current DB
 *   state at import time (not just trusted from the staged snapshot), so a
 *   no-op re-run or a stale staged file won't cause spurious writes.
 * - A "new" parent is inserted by email with insert-or-get semantics (safe
 *   if the same email appears twice in this file, or already exists in the
 *   DB despite being marked "new" in a since-gone-stale staged file).
 * - A "new" or "matched" student whose `classroom` is "matched" gets linked
 *   into student_classrooms for the staged school year (looked up from the
 *   staged file's `sourceSchoolYear`). A "not_found" classroom is left
 *   unlinked -- create it via the admin page and re-stage/re-import.
 * - students.preferred_name doesn't exist as a column -- any preferredName
 *   in the import is reported as dropped, not silently lost.
 *
 * Caveat: the neon-http driver this project uses doesn't support
 * transactions, so this is NOT atomic. On an error partway through one
 * family, that family's already-inserted parent/student rows stay in the
 * database (harmless to re-run -- parents dedupe by email, and cohort/
 * classroom updates are idempotent -- but you may end up with a duplicate
 * family/links if you re-run after a partial failure without checking
 * first).
 *
 * Usage:
 *   npx tsx scripts/import-staged-families.ts exclude/export-all-staged.json           # dry run
 *   npx tsx scripts/import-staged-families.ts exclude/export-all-staged.json --commit   # actually writes
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { count, eq } from "drizzle-orm";
import {
  parents,
  students,
  families,
  familyParents,
  familyStudents,
  schoolYears,
  studentClassrooms,
} from "../src/db/schema";

// ---- Input shapes (as written by stage-family-import.ts, possibly hand-edited) ----
// Fields beyond `status`/`existingId`/`proposedCohortYear` are optional here
// so this script still works against an older staged file that predates
// classroom staging -- it just won't have anything to update for those.

type StagedClassroom =
  | { status: "matched"; existingId: string; abbreviation: string }
  | { status: "not_found"; abbreviation: string };

type StagedParent =
  | { status: "matched"; existingId: string; email: string; firstName: string; lastName: string }
  | { status: "new"; email: string; firstName: string; lastName: string }
  | { status: "blocked"; reason: string; firstName: string | null; lastName: string | null };

type StagedStudent =
  | {
      status: "matched";
      existingId: string;
      firstName: string;
      lastName: string;
      currentCohortYear?: number | null;
      proposedCohortYear: number | null;
      classroom?: StagedClassroom | null;
    }
  | { status: "ambiguous"; candidates: string[]; firstName: string; lastName: string }
  | {
      status: "new";
      firstName: string;
      lastName: string;
      proposedCohortYear: number | null;
      preferredName: string | null;
      classroom?: StagedClassroom | null;
    };

interface StagedFamily {
  suggestedName: string | null;
  parents: StagedParent[];
  students: StagedStudent[];
}

async function main() {
  const { db } = await import("../src/db");

  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const inputPath = args.find((a) => !a.startsWith("--"));

  if (!inputPath) {
    console.log("Usage: npx tsx scripts/import-staged-families.ts <staged.json> [--commit]");
    process.exit(1);
  }

  const { families: staged, sourceSchoolYear } = JSON.parse(readFileSync(inputPath, "utf8")) as {
    families: StagedFamily[];
    sourceSchoolYear?: string;
  };

  console.log(
    commit
      ? "COMMIT mode -- this will write to the real database."
      : "DRY RUN -- no writes will happen. Pass --commit to actually import."
  );

  // Resolve the school year classroom links belong to, and load what's
  // currently linked for it so update decisions are based on live DB
  // state, not just the (possibly stale) staged snapshot.
  let targetSchoolYearId: string | null = null;
  let currentClassroomByStudentId = new Map<string, string>();
  if (sourceSchoolYear) {
    const [sy] = await db.select().from(schoolYears).where(eq(schoolYears.label, sourceSchoolYear));
    if (sy) {
      targetSchoolYearId = sy.id;
      const currentLinks = await db
        .select()
        .from(studentClassrooms)
        .where(eq(studentClassrooms.schoolYearId, sy.id));
      currentClassroomByStudentId = new Map(currentLinks.map((l) => [l.studentId, l.classroomId]));
    } else {
      console.log(
        `WARNING: staged file says school year "${sourceSchoolYear}", but no matching school_years row exists -- classroom assignments will be skipped.`
      );
    }
  }

  async function linkClassroom(studentId: string, classroomId: string) {
    if (!targetSchoolYearId) return;
    await db
      .insert(studentClassrooms)
      .values({ studentId, classroomId, schoolYearId: targetSchoolYearId })
      .onConflictDoUpdate({
        target: [studentClassrooms.studentId, studentClassrooms.schoolYearId],
        set: { classroomId },
      });
  }

  // In-run caches so a name/email repeated across families is only
  // inserted once, and so dry-run counts match what --commit would do.
  const parentIdByEmail = new Map<string, string>();
  const studentIdByName = new Map<string, string>();

  let familiesCreated = 0;
  let parentsInserted = 0;
  let parentsSkipped = 0;
  let studentsInserted = 0;
  let studentsSkipped = 0;
  let preferredNamesDropped = 0;
  let cohortYearsUpdated = 0;
  let classroomsLinked = 0;
  let classroomsNotFound = 0;
  const errors: string[] = [];

  for (const [i, family] of staged.entries()) {
    try {
      const parentIds: string[] = [];
      for (const p of family.parents) {
        if (p.status === "blocked") {
          parentsSkipped++;
          continue;
        }
        if (p.status === "matched") {
          parentIds.push(p.existingId);
          continue;
        }
        // status === "new"
        const email = p.email.toLowerCase().trim();
        const cached = parentIdByEmail.get(email);
        if (cached) {
          parentIds.push(cached);
          continue;
        }
        if (!commit) {
          parentsInserted++;
          const placeholder = `(dry-run:${email})`;
          parentIdByEmail.set(email, placeholder);
          parentIds.push(placeholder);
          continue;
        }
        const [inserted] = await db
          .insert(parents)
          .values({ email, firstName: p.firstName, lastName: p.lastName })
          .onConflictDoNothing({ target: parents.email })
          .returning();
        let id = inserted?.id;
        if (!id) {
          // Conflict -- someone/something already has this email. Fetch it
          // rather than fail, so a stale staged file or a repeated email
          // doesn't block the whole import.
          const [existing] = await db.select().from(parents).where(eq(parents.email, email));
          id = existing?.id;
        }
        if (!id) throw new Error(`couldn't insert or find parent ${email}`);
        parentIdByEmail.set(email, id);
        parentIds.push(id);
        parentsInserted++;
      }

      const studentIds: string[] = [];
      for (const s of family.students) {
        if (s.status === "ambiguous") {
          studentsSkipped++;
          continue;
        }
        if (s.classroom?.status === "not_found") classroomsNotFound++;

        if (s.status === "matched") {
          studentIds.push(s.existingId);

          const currentClassroomId = currentClassroomByStudentId.get(s.existingId) ?? null;
          const classroomChanged =
            s.classroom?.status === "matched" && s.classroom.existingId !== currentClassroomId;
          const cohortChanged = s.proposedCohortYear != null && s.proposedCohortYear !== s.currentCohortYear;

          if (commit) {
            if (cohortChanged) {
              await db.update(students).set({ cohortYear: s.proposedCohortYear }).where(eq(students.id, s.existingId));
            }
            if (classroomChanged && s.classroom?.status === "matched") {
              await linkClassroom(s.existingId, s.classroom.existingId);
            }
          }
          if (cohortChanged) cohortYearsUpdated++;
          if (classroomChanged) classroomsLinked++;
          continue;
        }

        // status === "new"
        if (s.preferredName) preferredNamesDropped++;
        const key = `${s.firstName.toLowerCase()} ${s.lastName.toLowerCase()}`;
        const cached = studentIdByName.get(key);
        if (cached) {
          studentIds.push(cached);
          continue;
        }
        if (!commit) {
          studentsInserted++;
          const placeholder = `(dry-run:${key})`;
          studentIdByName.set(key, placeholder);
          studentIds.push(placeholder);
          if (s.classroom?.status === "matched") classroomsLinked++;
          continue;
        }
        const [inserted] = await db
          .insert(students)
          .values({ firstName: s.firstName, lastName: s.lastName, cohortYear: s.proposedCohortYear })
          .returning();
        studentIdByName.set(key, inserted.id);
        studentIds.push(inserted.id);
        studentsInserted++;
        if (s.classroom?.status === "matched") {
          await linkClassroom(inserted.id, s.classroom.existingId);
          classroomsLinked++;
        }
      }

      if (parentIds.length === 0 && studentIds.length === 0) {
        errors.push(`Family #${i + 1} (${family.suggestedName ?? "unnamed"}) has nothing linkable -- skipped entirely`);
        continue;
      }

      if (!commit) {
        familiesCreated++;
        continue;
      }

      const [newFamily] = await db.insert(families).values({ name: family.suggestedName }).returning();
      if (parentIds.length > 0) {
        await db.insert(familyParents).values(parentIds.map((parentId) => ({ familyId: newFamily.id, parentId })));
      }
      if (studentIds.length > 0) {
        await db.insert(familyStudents).values(studentIds.map((studentId) => ({ familyId: newFamily.id, studentId })));
      }
      familiesCreated++;
    } catch (err) {
      errors.push(
        `Family #${i + 1} (${family.suggestedName ?? "unnamed"}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log(
    `\n${commit ? "Imported" : "Would import"}: ${familiesCreated} families, ${parentsInserted} new parents, ${studentsInserted} new students.`
  );
  console.log(`Skipped: ${parentsSkipped} blocked parent(s), ${studentsSkipped} ambiguous student(s).`);
  if (cohortYearsUpdated > 0) {
    console.log(`${commit ? "Updated" : "Would update"} cohort year for ${cohortYearsUpdated} existing student(s).`);
  }
  if (classroomsLinked > 0) {
    console.log(
      `${commit ? "Linked" : "Would link"} ${classroomsLinked} student(s) to a classroom for ${sourceSchoolYear ?? "the target school year"}.`
    );
  }
  if (classroomsNotFound > 0) {
    console.log(
      `${classroomsNotFound} student(s) have a homeroom with no matching classroom on file -- left unlinked (see stage-family-import.ts's issue list).`
    );
  }
  if (preferredNamesDropped > 0) {
    console.log(
      `Note: ${preferredNamesDropped} new student(s) have a preferred name in the import data, but students has no preferred_name column -- not stored anywhere.`
    );
  }
  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s):`);
    for (const e of errors) console.log(`  - ${e}`);
  }

  if (commit) {
    const [{ familyTotal }] = await db.select({ familyTotal: count() }).from(families);
    const [{ parentTotal }] = await db.select({ parentTotal: count() }).from(parents);
    const [{ studentTotal }] = await db.select({ studentTotal: count() }).from(students);
    console.log(`\nDatabase now has ${familyTotal} families, ${parentTotal} parents, ${studentTotal} students total.`);
  } else {
    console.log(`\nThis was a dry run -- nothing was written. Re-run with --commit to actually import.`);
  }
}

main();
