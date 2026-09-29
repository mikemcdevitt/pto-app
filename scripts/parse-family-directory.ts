/**
 * Parses the "family directory" export format (copy-pasted from the school's
 * directory/roster tool) into structured family/parent/student records.
 *
 * This is step 1 of populating the `families` table: turn the raw pasted
 * text into JSON Mike can review, before a later script matches these
 * against real `parents`/`students` rows and writes `families` /
 * `family_parents` / `family_students`. This script does NOT touch the
 * database -- it only parses and reports.
 *
 * Usage:
 *   npx tsx scripts/parse-family-directory.ts <input.txt> [-o output.json]
 *   pbpaste | npx tsx scripts/parse-family-directory.ts -            (stdin)
 *
 * Input is assumed to look like this, repeated per family, with no blank
 * lines between entries -- 1 or 2 parent blocks (Last, First / optional
 * email / optional address lines / optional h:/m: phone lines) followed by
 * 1+ student blocks (First Last (Grade) / optional preferred_name / optional
 * Home Room Teacher / optional Home Room):
 *
 *   Doe, Jane
 *   [jane.doe@example.com](mailto:jane.doe@example.com)
 *   m: (555) 123-4567
 *   Alex Doe (4th Grade)
 *   Home Room Teacher: 4 - Smith, Pat
 *   Home Room: 4PS
 *
 * NOTE ON PII: this file's *output* contains real names/emails/phones/
 * addresses when run against real data. Don't commit that output (or a
 * sample input containing real families) into the repo -- keep the source
 * export and any JSON it produces outside version control.
 */

import { readFileSync, writeFileSync } from "node:fs";

// Mirrors src/lib/grades.ts's Grade type/ordering, so this output plugs
// directly into the same K-5 vocabulary the rest of the app uses.
type Grade = "kindergarten" | "first" | "second" | "third" | "fourth" | "fifth";

const GRADE_TEXT_TO_ENUM: Record<string, Grade> = {
  kindergarten: "kindergarten",
  "1st grade": "first",
  "2nd grade": "second",
  "3rd grade": "third",
  "4th grade": "fourth",
  "5th grade": "fifth",
};

const GRADE_NUM_TO_ENUM: Record<string, Grade> = {
  k: "kindergarten",
  "1": "first",
  "2": "second",
  "3": "third",
  "4": "fourth",
  "5": "fifth",
};

const HEADER_LINES_TO_SKIP = new Set(["Parent", "2nd Parent", "Students"]);

interface ParsedPhone {
  type: "h" | "m";
  number: string;
}

interface ParsedParent {
  lastName: string;
  firstName: string;
  email: string | null;
  phones: ParsedPhone[];
  address: string | null;
}

interface ParsedHomeroomTeacher {
  gradeNum: string | null; // the "4" or "K" before the dash, as given
  name: string | null; // "Smith, Pat" when it parsed cleanly
  lastName: string | null;
  firstName: string | null;
  raw: string; // always kept, in case the structured parse is wrong
}

interface ParsedStudent {
  fullName: string;
  guessedFirstName: string;
  guessedLastName: string;
  gradeRaw: string;
  grade: Grade | null;
  preferredName: string | null;
  homeroomTeacher: ParsedHomeroomTeacher | null;
  homeroomAbbrev: string | null;
}

interface ParsedFamily {
  parents: ParsedParent[];
  students: ParsedStudent[];
}

interface Warning {
  line: number;
  message: string;
}

function normalizeGrade(raw: string): Grade | null {
  return GRADE_TEXT_TO_ENUM[raw.trim().toLowerCase()] ?? null;
}

function parseHomeroomTeacher(raw: string, lineNo: number, warnings: Warning[]): ParsedHomeroomTeacher {
  const rest = raw.replace(/^Home Room Teacher:\s*/i, "").trim();
  const dashMatch = rest.match(/^([Kk0-9]+)\s*-\s*(.+)$/);
  if (!dashMatch) {
    warnings.push({ line: lineNo, message: `Home Room Teacher line didn't match "<grade> - <name>": "${rest}"` });
    return { gradeNum: null, name: null, lastName: null, firstName: null, raw: rest };
  }
  const [, gradeNum, name] = dashMatch;
  const nameParts = name.split(",").map((p) => p.trim());
  if (nameParts.length !== 2) {
    warnings.push({
      line: lineNo,
      message: `Teacher name not in "Last, First" format (check for a typo, e.g. a period instead of a comma): "${name}"`,
    });
    return { gradeNum, name, lastName: null, firstName: null, raw: rest };
  }
  return { gradeNum, name, lastName: nameParts[0], firstName: nameParts[1], raw: rest };
}

function splitStudentName(fullName: string): { guessedFirstName: string; guessedLastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return {
    guessedFirstName: parts.slice(0, -1).join(" "),
    guessedLastName: parts[parts.length - 1],
  };
}

type Classified =
  | { type: "skip" }
  | { type: "email"; email: string }
  | { type: "phone"; phone: ParsedPhone }
  | { type: "preferredName"; value: string }
  | { type: "homeroomTeacher"; raw: string }
  | { type: "homeroomAbbrev"; value: string }
  | { type: "studentHeader"; fullName: string; gradeRaw: string }
  | { type: "parentHeader"; lastName: string; firstName: string }
  | { type: "detail"; text: string };

const EMAIL_RE = /^\[(.+?)\]\(mailto:(.+?)\)$/;
const PHONE_RE = /^(h|m):\s*(.+)$/;
const PREFERRED_NAME_RE = /^preferred_name:\s*(.+)$/i;
const HOMEROOM_TEACHER_RE = /^Home Room Teacher:/i;
const HOMEROOM_RE = /^Home Room:\s*(.+)$/i;
const STUDENT_HEADER_RE = /^(.+?)\s+\((Kindergarten|[1-5](?:st|nd|rd|th) Grade)\)$/;
const PARENT_HEADER_RE = /^([A-Za-zÀ-ÿ'.\-]+(?: [A-Za-zÀ-ÿ'.\-]+)*),\s*([A-Za-zÀ-ÿ'.\-]+(?: [A-Za-zÀ-ÿ'.\-]+)*)$/;

function classify(line: string): Classified {
  if (HEADER_LINES_TO_SKIP.has(line)) return { type: "skip" };

  const email = line.match(EMAIL_RE);
  if (email) return { type: "email", email: email[2] };

  const phone = line.match(PHONE_RE);
  if (phone) return { type: "phone", phone: { type: phone[1] as "h" | "m", number: phone[2].trim() } };

  const preferredName = line.match(PREFERRED_NAME_RE);
  if (preferredName) return { type: "preferredName", value: preferredName[1].trim() };

  if (HOMEROOM_TEACHER_RE.test(line)) return { type: "homeroomTeacher", raw: line };

  const homeroom = line.match(HOMEROOM_RE);
  if (homeroom) return { type: "homeroomAbbrev", value: homeroom[1].trim() };

  const student = line.match(STUDENT_HEADER_RE);
  if (student) return { type: "studentHeader", fullName: student[1].trim(), gradeRaw: student[2].trim() };

  const parent = line.match(PARENT_HEADER_RE);
  if (parent) return { type: "parentHeader", lastName: parent[1].trim(), firstName: parent[2].trim() };

  return { type: "detail", text: line };
}

function parseDirectory(input: string): { families: ParsedFamily[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const families: ParsedFamily[] = [];

  let currentFamily: ParsedFamily | null = null;
  let currentEntity: { kind: "parent"; parent: ParsedParent } | { kind: "student"; student: ParsedStudent } | null = null;
  const addressLinesByParent = new WeakMap<ParsedParent, string[]>();

  const lines = input.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    const lineNo = idx + 1;
    if (line === "") return;

    const c = classify(line);

    switch (c.type) {
      case "skip":
        return;

      case "parentHeader": {
        const parent: ParsedParent = {
          lastName: c.lastName,
          firstName: c.firstName,
          email: null,
          phones: [],
          address: null,
        };
        addressLinesByParent.set(parent, []);

        if (!currentFamily) {
          currentFamily = { parents: [], students: [] };
        } else if (currentFamily.students.length > 0) {
          families.push(currentFamily);
          currentFamily = { parents: [], students: [] };
        }
        currentFamily.parents.push(parent);
        currentEntity = { kind: "parent", parent };
        return;
      }

      case "studentHeader": {
        const grade = normalizeGrade(c.gradeRaw);
        if (!grade) {
          warnings.push({ line: lineNo, message: `Couldn't normalize grade "${c.gradeRaw}" for student "${c.fullName}"` });
        }
        const { guessedFirstName, guessedLastName } = splitStudentName(c.fullName);
        if (c.fullName.trim().split(/\s+/).length > 2) {
          warnings.push({
            line: lineNo,
            message: `"${c.fullName}" has more than two words -- first/last name split is a guess (guessed "${guessedFirstName}" / "${guessedLastName}"), verify against the roster`,
          });
        }
        const student: ParsedStudent = {
          fullName: c.fullName,
          guessedFirstName,
          guessedLastName,
          gradeRaw: c.gradeRaw,
          grade,
          preferredName: null,
          homeroomTeacher: null,
          homeroomAbbrev: null,
        };
        if (!currentFamily) {
          warnings.push({ line: lineNo, message: `Student "${c.fullName}" appeared with no parent block before it` });
          currentFamily = { parents: [], students: [] };
        }
        currentFamily.students.push(student);
        currentEntity = { kind: "student", student };
        return;
      }

      case "email": {
        if (currentEntity?.kind === "parent") {
          currentEntity.parent.email = c.email;
        } else {
          warnings.push({ line: lineNo, message: `Email line "${c.email}" didn't follow a parent: ${line}` });
        }
        return;
      }

      case "phone": {
        if (currentEntity?.kind === "parent") {
          currentEntity.parent.phones.push(c.phone);
        } else {
          warnings.push({ line: lineNo, message: `Phone line didn't follow a parent: ${line}` });
        }
        return;
      }

      case "preferredName": {
        if (currentEntity?.kind === "student") {
          currentEntity.student.preferredName = c.value;
        } else {
          warnings.push({ line: lineNo, message: `preferred_name line didn't follow a student: ${line}` });
        }
        return;
      }

      case "homeroomTeacher": {
        if (currentEntity?.kind === "student") {
          currentEntity.student.homeroomTeacher = parseHomeroomTeacher(c.raw, lineNo, warnings);
          const t = currentEntity.student.homeroomTeacher;
          const expected = t.gradeNum ? GRADE_NUM_TO_ENUM[t.gradeNum.toLowerCase()] ?? null : null;
          if (expected && currentEntity.student.grade && expected !== currentEntity.student.grade) {
            warnings.push({
              line: lineNo,
              message: `${currentEntity.student.fullName} is marked "${currentEntity.student.gradeRaw}" but homeroom teacher is listed under grade "${t.gradeNum}" -- check this row`,
            });
          }
        } else {
          warnings.push({ line: lineNo, message: `Home Room Teacher line didn't follow a student: ${line}` });
        }
        return;
      }

      case "homeroomAbbrev": {
        if (currentEntity?.kind === "student") {
          currentEntity.student.homeroomAbbrev = c.value;
        } else {
          warnings.push({ line: lineNo, message: `Home Room line didn't follow a student: ${line}` });
        }
        return;
      }

      case "detail": {
        if (currentEntity?.kind === "parent") {
          addressLinesByParent.get(currentEntity.parent)!.push(line);
        } else {
          warnings.push({ line: lineNo, message: `Unrecognized line: "${line}"` });
        }
        return;
      }
    }
  });

  if (currentFamily) families.push(currentFamily);

  // Fold collected address lines into each parent's `address` field.
  for (const family of families) {
    for (const parent of family.parents) {
      const addrLines = addressLinesByParent.get(parent) ?? [];
      parent.address = addrLines.length > 0 ? addrLines.join(", ") : null;
    }
  }

  return { families, warnings };
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.findIndex((a) => a === "-o" || a === "--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const inputArgs = args.filter((a, i) => i !== outIdx && i !== outIdx + 1);
  const inputPath = inputArgs[0];

  if (!inputPath) {
    console.error("Usage: npx tsx scripts/parse-family-directory.ts <input.txt> [-o output.json]");
    process.exit(1);
  }

  const raw = inputPath === "-" ? readFileSync(0, "utf8") : readFileSync(inputPath, "utf8");
  const { families, warnings } = parseDirectory(raw);

  const parentCount = families.reduce((sum, f) => sum + f.parents.length, 0);
  const studentCount = families.reduce((sum, f) => sum + f.students.length, 0);

  const json = JSON.stringify({ families }, null, 2);
  if (outPath) {
    writeFileSync(outPath, json);
    console.error(`Wrote ${outPath}`);
  } else {
    console.log(json);
  }

  console.error(`\nParsed ${families.length} families, ${parentCount} parents, ${studentCount} students.`);
  if (warnings.length > 0) {
    console.error(`\n${warnings.length} warning(s) -- worth a look before trusting this data:`);
    for (const w of warnings) {
      console.error(`  line ${w.line}: ${w.message}`);
    }
  } else {
    console.error("No warnings.");
  }
}

main();
