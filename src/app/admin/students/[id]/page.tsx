import { db } from "@/db";
import { students, schoolYears, classrooms, studentClassrooms } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { Grade } from "@/lib/grades";
import StudentForm from "../StudentForm";

// Always hit the database on request; this route has no dynamic
// function calls (no auth()/cookies()/searchParams), so Next.js would
// otherwise be free to statically prerender it once and keep serving
// that snapshot until the next deploy -- meaning new/edited parents
// or students wouldn't show up here without a redeploy.
export const dynamic = "force-dynamic";

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [student] = await db.select().from(students).where(eq(students.id, id));
  if (!student) notFound();

  // Most recent school year, to drive the cohort-based classroom picklist
  // below -- same "current year" convention used on the parent dashboard.
  const [currentYear] = await db
    .select()
    .from(schoolYears)
    .orderBy(desc(schoolYears.sortYear))
    .limit(1);

  let classroomsForYear: {
    id: string;
    teacherName: string;
    abbreviation: string;
    grade: Grade;
  }[] = [];
  let currentClassroomId: string | null = null;

  if (currentYear) {
    classroomsForYear = await db
      .select({
        id: classrooms.id,
        teacherName: classrooms.teacherName,
        abbreviation: classrooms.abbreviation,
        grade: classrooms.grade,
      })
      .from(classrooms)
      .where(eq(classrooms.schoolYearId, currentYear.id))
      .orderBy(asc(classrooms.grade), asc(classrooms.abbreviation));

    const [assignment] = await db
      .select({ classroomId: studentClassrooms.classroomId })
      .from(studentClassrooms)
      .where(
        and(
          eq(studentClassrooms.studentId, id),
          eq(studentClassrooms.schoolYearId, currentYear.id)
        )
      );
    currentClassroomId = assignment?.classroomId ?? null;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Edit Student</h1>
      <StudentForm
        initialData={student}
        currentSchoolYear={
          currentYear
            ? { id: currentYear.id, label: currentYear.label, sortYear: currentYear.sortYear }
            : undefined
        }
        classroomsForYear={classroomsForYear}
        currentClassroomId={currentClassroomId}
      />
    </div>
  );
}
