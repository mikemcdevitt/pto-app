import { db } from "@/db";
import { students, schoolYears, classrooms, studentClassrooms } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { GRADE_ORDER, cohortStatusInSchoolYear, type Grade, type CohortStatus } from "@/lib/grades";
import RosterFilters from "./RosterFilters";
import RosterTable from "./RosterTable";

// Always hit the database on request; this route has no dynamic
// function calls (no auth()/cookies()/searchParams), so Next.js would
// otherwise be free to statically prerender it once and keep serving
// that snapshot until the next deploy -- meaning new/edited parents
// or students wouldn't show up here without a redeploy.
export const dynamic = "force-dynamic";

// Grade roster + classroom assignment, all on the Students list rather
// than a separate route. ?schoolYearId picks the year (defaults to the
// most recent), ?grade filters to one grade, and ?classroomId (set by the
// Abbreviation link on the Classrooms page) narrows to one class's roster.
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ schoolYearId?: string; grade?: string; classroomId?: string }>;
}) {
  const { schoolYearId, grade: gradeParam, classroomId: classroomIdParam } = await searchParams;

  const years = await db.select().from(schoolYears).orderBy(desc(schoolYears.sortYear));

  if (years.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Students</h1>
        <p className="text-gray-500">
          No school years have been set up yet — add one before assigning students to classrooms.
        </p>
      </div>
    );
  }

  const selectedYear = years.find((y) => y.id === schoolYearId) ?? years[0];

  const gradeFilter: Grade | null =
    gradeParam && (GRADE_ORDER as readonly string[]).includes(gradeParam)
      ? (gradeParam as Grade)
      : null;

  const classroomsForYear = await db
    .select({
      id: classrooms.id,
      teacherName: classrooms.teacherName,
      abbreviation: classrooms.abbreviation,
      grade: classrooms.grade,
    })
    .from(classrooms)
    .where(eq(classrooms.schoolYearId, selectedYear.id))
    .orderBy(asc(classrooms.grade), asc(classrooms.abbreviation));

  const classroomsByGrade = classroomsForYear.reduce<Partial<Record<Grade, typeof classroomsForYear>>>(
    (acc, c) => {
      (acc[c.grade] ??= []).push(c);
      return acc;
    },
    {}
  );

  const classroomFilter = classroomIdParam
    ? classroomsForYear.find((c) => c.id === classroomIdParam) ?? null
    : null;

  const rows = await db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      cohortYear: students.cohortYear,
      classroomId: studentClassrooms.classroomId,
    })
    .from(students)
    .leftJoin(
      studentClassrooms,
      and(
        eq(studentClassrooms.studentId, students.id),
        eq(studentClassrooms.schoolYearId, selectedYear.id)
      )
    )
    .orderBy(asc(students.lastName), asc(students.firstName));

  // K..5 sort first (grouped into a grade-by-grade roster), then students
  // whose cohort doesn't resolve to a grade this year, least-actionable
  // last: upcoming cohorts, then graduated, then missing data entirely
  // (most in need of a fix, but not part of any current-year roster).
  const sortIndex = (status: CohortStatus) =>
    status.kind === "grade"
      ? GRADE_ORDER.indexOf(status.grade)
      : status.kind === "not-yet"
        ? 6
        : status.kind === "graduated"
          ? 7
          : 8;

  const rosterStudents = rows
    .map((r) => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      status: cohortStatusInSchoolYear(r.cohortYear, selectedYear.sortYear),
      classroomId: r.classroomId,
    }))
    .filter((s) => (gradeFilter ? s.status.kind === "grade" && s.status.grade === gradeFilter : true))
    .filter((s) => (classroomFilter ? s.classroomId === classroomFilter.id : true))
    .sort((a, b) => {
      const diff = sortIndex(a.status) - sortIndex(b.status);
      if (diff !== 0) return diff;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Students</h1>
        <Link href="/admin/students/new" className="px-4 py-2 bg-blue-600 text-white rounded">
          Add Student
        </Link>
      </div>

      <RosterFilters
        schoolYears={years}
        selectedSchoolYearId={selectedYear.id}
        selectedGrade={gradeFilter ?? undefined}
      />

      {classroomFilter && (
        <p className="text-sm text-gray-600 mb-4">
          Showing roster for {classroomFilter.teacherName} ({classroomFilter.abbreviation}),{" "}
          {selectedYear.label}.{" "}
          <Link
            href={`/admin/students?schoolYearId=${selectedYear.id}`}
            className="text-blue-600 underline"
          >
            Clear
          </Link>
        </p>
      )}

      <RosterTable
        key={`${selectedYear.id}-${gradeFilter ?? "all"}-${classroomFilter?.id ?? "all"}`}
        students={rosterStudents}
        classroomsByGrade={classroomsByGrade}
        selectedSchoolYearId={selectedYear.id}
      />
    </div>
  );
}
