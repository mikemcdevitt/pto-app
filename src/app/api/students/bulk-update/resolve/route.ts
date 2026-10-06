import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { classrooms, schoolYears, students, studentClassrooms } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { GRADE_ORDER, parseGradeLabel } from "@/lib/grades";

// Read-only: parses nothing (that happens client-side -- see
// BulkUpdateForm) and writes nothing. Takes the rows the client already
// split out of the pasted/uploaded text and, for each one, works out
// what (if anything) it would change -- the actual write happens later,
// only for whatever the admin checks off, via the sibling apply route.
//
// Matching is name + calculated cohort year (not name alone, since two
// different students can share a name): the row's Grade column plus the
// selected school year's sortYear gives an expected cohortYear, the same
// formula gradeForCohortInSchoolYear uses in reverse, and that's compared
// against students.cohortYear.

interface RawRow {
  rowIndex: number;
  firstName: string;
  lastName: string;
  gradeRaw: string;
  homeroomRaw: string;
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const schoolYearId: string | undefined = body.schoolYearId;
  const rows: RawRow[] = Array.isArray(body.rows) ? body.rows : [];

  if (!schoolYearId) {
    return NextResponse.json({ error: "schoolYearId is required" }, { status: 400 });
  }

  const [schoolYear] = await db.select().from(schoolYears).where(eq(schoolYears.id, schoolYearId));
  if (!schoolYear) {
    return NextResponse.json({ error: "No such school year" }, { status: 404 });
  }

  const classroomsForYear = await db
    .select({ id: classrooms.id, abbreviation: classrooms.abbreviation, grade: classrooms.grade })
    .from(classrooms)
    .where(eq(classrooms.schoolYearId, schoolYearId));
  const classroomByAbbreviation = new Map(
    classroomsForYear.map((c) => [c.abbreviation.toLowerCase(), c])
  );

  const allStudents = await db
    .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, cohortYear: students.cohortYear })
    .from(students);

  const existingClassroomRows =
    allStudents.length > 0
      ? await db
          .select({ studentId: studentClassrooms.studentId, classroomId: studentClassrooms.classroomId })
          .from(studentClassrooms)
          .where(
            and(
              eq(studentClassrooms.schoolYearId, schoolYearId),
              inArray(studentClassrooms.studentId, allStudents.map((s) => s.id))
            )
          )
      : [];
  const currentClassroomByStudentId = new Map(existingClassroomRows.map((r) => [r.studentId, r.classroomId]));

  const results = rows.map((row) => {
    const firstName = row.firstName.trim();
    const lastName = row.lastName.trim();
    const homeroomRaw = row.homeroomRaw.trim();
    const issues: string[] = [];

    if (!firstName || !lastName) {
      return { rowIndex: row.rowIndex, firstName, lastName, status: "error" as const, issues: ["Missing first or last name"] };
    }

    const grade = parseGradeLabel(row.gradeRaw);
    if (!grade) {
      return {
        rowIndex: row.rowIndex,
        firstName,
        lastName,
        status: "error" as const,
        issues: [`Couldn't make sense of grade "${row.gradeRaw}"`],
      };
    }
    const cohortYear = schoolYear.sortYear - GRADE_ORDER.indexOf(grade) + 5;

    const resolvedClassroom = homeroomRaw ? classroomByAbbreviation.get(homeroomRaw.toLowerCase()) : undefined;
    let resolvedClassroomId: string | null = null;
    if (homeroomRaw && !resolvedClassroom) {
      issues.push(`No classroom with abbreviation "${homeroomRaw}" in ${schoolYear.label}`);
    } else if (resolvedClassroom) {
      resolvedClassroomId = resolvedClassroom.id;
      if (resolvedClassroom.grade !== grade) {
        issues.push(
          `Classroom "${homeroomRaw}" is a ${resolvedClassroom.grade} classroom, but this row says grade "${row.gradeRaw}"`
        );
      }
    }

    const matches = allStudents.filter(
      (s) =>
        s.firstName.toLowerCase() === firstName.toLowerCase() &&
        s.lastName.toLowerCase() === lastName.toLowerCase() &&
        s.cohortYear === cohortYear
    );

    if (matches.length > 1) {
      return {
        rowIndex: row.rowIndex,
        firstName,
        lastName,
        grade,
        cohortYear,
        homeroomRaw,
        resolvedClassroomId,
        status: "ambiguous" as const,
        matchedStudentIds: matches.map((m) => m.id),
        issues: [...issues, `${matches.length} existing students match this name and cohort -- resolve the duplicate by hand first`],
      };
    }

    if (matches.length === 0) {
      return {
        rowIndex: row.rowIndex,
        firstName,
        lastName,
        grade,
        cohortYear,
        homeroomRaw,
        resolvedClassroomId,
        status: "new" as const,
        issues,
      };
    }

    const student = matches[0];
    const currentClassroomId = currentClassroomByStudentId.get(student.id) ?? null;
    const needsUpdate = issues.length === 0 && resolvedClassroomId !== currentClassroomId;

    return {
      rowIndex: row.rowIndex,
      firstName,
      lastName,
      grade,
      cohortYear,
      homeroomRaw,
      resolvedClassroomId,
      studentId: student.id,
      currentClassroomId,
      status: issues.length > 0 ? ("error" as const) : needsUpdate ? ("update" as const) : ("no-change" as const),
      issues,
    };
  });

  return NextResponse.json({ results, classroomsForYear });
}
