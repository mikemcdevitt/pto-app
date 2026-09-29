/**
 * Reads a parsed family-directory JSON file (from parse_family_numbers.py
 * or parse-family-directory.ts) and stages it against the REAL Neon
 * database: matches each parent/student to an existing row where possible,
 * and reports what would be inserted/updated/skipped.
 *
 * READ-ONLY. This never writes to the database -- it's the "look before
 * you leap" step before a future insert script. Review the report (console
 * summary + the JSON file it writes), fix up anything flagged, then we'll
 * build the actual insert step from what this confirms.
 *
 * Cohort years are computed relative to the school year the *source
 * export* was pulled under, not whatever pto-app currently considers its
 * active year -- Membership Toolkit's active year for this export was
 * "2025-2026", one year behind pto-app's current "2026-2027". Pass
 * --school-year to point at a different export's year if that changes.
 *
 * Usage:
 *   npx tsx scripts/stage-family-import.ts exclude/export-p10-parsed.json -o exclude/export-p10-staged.json
 *   npx tsx scripts/stage-family-import.ts exclude/export-p10-parsed.json --school-year "2025-2026"
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import { count, eq } from "drizzle-orm";
import { parents, students, schoolYears, families } from "../src/db/schema";
import { GRADE_ORDER, type Grade } from "../src/lib/grades";

// `db` is loaded dynamically, *after* dotenv has populated process.env.
// A static `import { db } from "../src/db"` up here would get hoisted
// above the config() call above (ES module imports always run before any
// other top-level code, regardless of source order), so src/db/index.ts's
// `neon(process.env.DATABASE_URL!)` would run before .env.local is loaded
// -- which is exactly the "No database connection string was provided to
// neon()" error. Dynamic import() runs inline, so this avoids that.

const DEFAULT_SOURCE_SCHOOL_YEAR_LABEL = "2025-2026";

// ---- Types matching the parser's JSON output -------------------------

interface ParsedPhone {
  type: "h" | "m";
  number: string;
}
interface ParsedParent {
  lastName: string | null;
  firstName: string | null;
  email: string | null;
  phones: ParsedPhone[];
  address: string | null;
}
interface ParsedStudent {
  fullName: string;
  guessedFirstName: string;
  guessedLastName: string;
  gradeRaw: string;
  grade: Grade | null;
  preferredName: string | null;
  homeroomTeacher: { gradeNum: string | null; name: string | null } | null;
  homeroomAbbrev: string | null;
}
interface ParsedFamily {
  parents: ParsedParent[];
  students: ParsedStudent[];
}

// ---- Staged output shapes ----------------------------------------------

type StagedParent =
  | { status: "matched"; existingId: string; email: string; firstName: string; lastName: string; nameMismatch: string | null }
  | { status: "new"; email: string; firstName: string; lastName: string; duplicateInImport: boolean }
  | { status: "blocked"; reason: string; firstName: string | null; lastName: string | null };

type StagedStudent =
  | {
      status: "matched";
      existingId: string;
      firstName: string;
      lastName: string;
      currentCohortYear: number | null;
      proposedCohortYear: number | null;
      cohortMismatch: boolean;
    }
  | {
      status: "ambiguous";
      candidates: string[];
      firstName: string;
      lastName: string;
      note: string;
    }
  | {
      status: "new";
      firstName: string;
      lastName: string;
      proposedCohortYear: number | null;
      lowConfidenceNameSplit: boolean;
      preferredName: string | null;
    };

interface StagedFamily {
  suggestedName: string | null;
  parents: StagedParent[];
  students: StagedStudent[];
}

// ---- Helpers -------------------------------------------------------------

function normEmail(email: string | null): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

function normName(s: string): string {
  return s.trim().toLowerCase();
}

async function main() {
  const { db } = await import("../src/db");

  const args = process.argv.slice(2);
  const outIdx = args.findIndex((a) => a === "-o" || a === "--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const yearIdx = args.findIndex((a) => a === "--school-year");
  const sourceYearLabel = yearIdx >= 0 ? args[yearIdx + 1] : DEFAULT_SOURCE_SCHOOL_YEAR_LABEL;
  const skipIdx = new Set<number>();
  if (outIdx >= 0) skipIdx.add(outIdx).add(outIdx + 1);
  if (yearIdx >= 0) skipIdx.add(yearIdx).add(yearIdx + 1);
  const inputPath = args.filter((_, i) => !skipIdx.has(i))[0];

  if (!inputPath) {
    console.error(
      "Usage: npx tsx scripts/stage-family-import.ts <parsed.json> [-o staged.json] [--school-year \"2025-2026\"]"
    );
    process.exit(1);
  }

  const { families: parsedFamilies } = JSON.parse(readFileSync(inputPath, "utf8")) as {
    families: ParsedFamily[];
  };

  // ---- Load reference data from the real database ----
  // Cohort years are computed relative to *this* school year -- the one
  // the export's grade levels were true as of -- not pto-app's current one.
  const [sourceYear] = await db.select().from(schoolYears).where(eq(schoolYears.label, sourceYearLabel));
  if (!sourceYear) {
    console.error(
      `No school_years row with label "${sourceYearLabel}" -- can't compute cohort years. ` +
        `Pass --school-year "<label>" to point at the right one. Aborting.`
    );
    process.exit(1);
  }

  const existingParents = await db.select().from(parents);
  const existingStudents = await db.select().from(students);
  const [{ familyCount }] = await db.select({ familyCount: count() }).from(families);

  const parentByEmail = new Map(existingParents.map((p) => [normEmail(p.email)!, p]));
  const studentsByName = new Map<string, typeof existingStudents>();
  for (const s of existingStudents) {
    const key = normName(`${s.firstName} ${s.lastName}`);
    studentsByName.set(key, [...(studentsByName.get(key) ?? []), s]);
  }

  console.error(
    `Reference data: cohort years computed as of "${sourceYear.label}" (sortYear ${sourceYear.sortYear}), ` +
      `${existingParents.length} existing parents, ${existingStudents.length} existing students, ` +
      `${familyCount} existing families.`
  );
  if (familyCount > 0) {
    console.error(
      `WARNING: families table isn't empty (${familyCount} rows) -- this script doesn't check for ` +
        `already-staged families, so re-running it on data you've already imported will look identical ` +
        `to new data. Make sure this input hasn't been imported before.`
    );
  }

  const seenNewParentEmails = new Set<string>();

  function stageParent(p: ParsedParent): StagedParent {
    const email = normEmail(p.email);
    if (!email) {
      return {
        status: "blocked",
        reason: "no email on file -- parents.email is required and unique, can't insert without one",
        firstName: p.firstName,
        lastName: p.lastName,
      };
    }
    const existing = parentByEmail.get(email);
    if (existing) {
      const nameMismatch =
        normName(existing.firstName) !== normName(p.firstName ?? "") ||
        normName(existing.lastName) !== normName(p.lastName ?? "")
          ? `DB has "${existing.firstName} ${existing.lastName}", import has "${p.firstName} ${p.lastName}"`
          : null;
      return {
        status: "matched",
        existingId: existing.id,
        email,
        firstName: p.firstName ?? existing.firstName,
        lastName: p.lastName ?? existing.lastName,
        nameMismatch,
      };
    }
    const duplicateInImport = seenNewParentEmails.has(email);
    seenNewParentEmails.add(email);
    return {
      status: "new",
      email,
      firstName: p.firstName ?? "",
      lastName: p.lastName ?? "",
      duplicateInImport,
    };
  }

  function proposeCohortYear(grade: Grade | null): number | null {
    if (!grade) return null;
    const index = GRADE_ORDER.indexOf(grade);
    return sourceYear.sortYear - index + 5;
  }

  function stageStudent(s: ParsedStudent): StagedStudent {
    const key = normName(s.fullName);
    const candidates = studentsByName.get(key) ?? [];
    const proposedCohortYear = proposeCohortYear(s.grade);

    if (candidates.length === 1) {
      const existing = candidates[0];
      return {
        status: "matched",
        existingId: existing.id,
        firstName: existing.firstName,
        lastName: existing.lastName,
        currentCohortYear: existing.cohortYear,
        proposedCohortYear,
        cohortMismatch:
          existing.cohortYear != null && proposedCohortYear != null && existing.cohortYear !== proposedCohortYear,
      };
    }
    if (candidates.length > 1) {
      return {
        status: "ambiguous",
        candidates: candidates.map((c) => c.id),
        firstName: s.guessedFirstName,
        lastName: s.guessedLastName,
        note: `${candidates.length} existing students share the name "${s.fullName}" -- resolve manually`,
      };
    }
    return {
      status: "new",
      firstName: s.guessedFirstName,
      lastName: s.guessedLastName,
      proposedCohortYear,
      lowConfidenceNameSplit: s.fullName.trim().split(/\s+/).length > 2,
      preferredName: s.preferredName,
    };
  }

  const staged: StagedFamily[] = parsedFamilies.map((f) => {
    const stagedParents = f.parents.map(stageParent);
    const lastNames = new Set(
      stagedParents.map((p) => ("lastName" in p ? p.lastName : null)).filter((n): n is string => !!n)
    );
    return {
      suggestedName: lastNames.size === 1 ? `${[...lastNames][0]} Family` : null,
      parents: stagedParents,
      students: f.students.map(stageStudent),
    };
  });

  // ---- Report ----
  const flatParents = staged.flatMap((f) => f.parents);
  const flatStudents = staged.flatMap((f) => f.students);
  const counts = {
    parents: {
      matched: flatParents.filter((p) => p.status === "matched").length,
      new: flatParents.filter((p) => p.status === "new").length,
      blocked: flatParents.filter((p) => p.status === "blocked").length,
    },
    students: {
      matched: flatStudents.filter((s) => s.status === "matched").length,
      new: flatStudents.filter((s) => s.status === "new").length,
      ambiguous: flatStudents.filter((s) => s.status === "ambiguous").length,
    },
  };

  const payload = JSON.stringify({ families: staged, sourceSchoolYear: sourceYear.label, counts }, null, 2);
  if (outPath) {
    writeFileSync(outPath, payload);
    console.error(`\nWrote ${outPath}`);
  } else {
    console.log(payload);
  }

  console.error(`\n${staged.length} families staged.`);
  console.error(
    `Parents: ${counts.parents.matched} matched, ${counts.parents.new} new, ${counts.parents.blocked} blocked (no email).`
  );
  console.error(
    `Students: ${counts.students.matched} matched, ${counts.students.new} new, ${counts.students.ambiguous} ambiguous (name collision).`
  );

  const issues: string[] = [];
  for (const p of flatParents) {
    if (p.status === "blocked") issues.push(`BLOCKED parent "${p.firstName} ${p.lastName}": ${p.reason}`);
    if (p.status === "matched" && p.nameMismatch) issues.push(`Parent name mismatch (${p.email}): ${p.nameMismatch}`);
    if (p.status === "new" && p.duplicateInImport) issues.push(`Parent "${p.email}" appears as "new" in more than one family in this import`);
  }
  for (const s of flatStudents) {
    if (s.status === "ambiguous") issues.push(`AMBIGUOUS student "${s.firstName} ${s.lastName}": ${s.note}`);
    if (s.status === "matched" && s.cohortMismatch)
      issues.push(
        `Cohort year mismatch for "${s.firstName} ${s.lastName}": DB has ${s.currentCohortYear}, import implies ${s.proposedCohortYear}`
      );
    if (s.status === "new" && s.lowConfidenceNameSplit)
      issues.push(`New student "${s.firstName} ${s.lastName}" -- name split guessed from 3+ words, verify`);
  }

  if (issues.length > 0) {
    console.error(`\n${issues.length} issue(s) worth reviewing before inserting:`);
    for (const i of issues) console.error(`  - ${i}`);
  } else {
    console.error("\nNo issues flagged.");
  }
}

main();
