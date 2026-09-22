import { db } from "@/db";
import { studentClassrooms } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// Upserts or clears a student's classroom assignment for a given school
// year. classroomId === null clears any existing assignment for that year
// (used when the admin picks "Unassigned"). Shared by the Edit Student
// form's PATCH handler and the inline picklist on the Students roster
// list, so the two stay in sync.
export async function assignStudentClassroom(
  studentId: string,
  schoolYearId: string,
  classroomId: string | null
) {
  if (classroomId) {
    await db
      .insert(studentClassrooms)
      .values({ studentId, schoolYearId, classroomId })
      .onConflictDoUpdate({
        target: [studentClassrooms.studentId, studentClassrooms.schoolYearId],
        set: { classroomId },
      });
  } else {
    await db
      .delete(studentClassrooms)
      .where(
        and(
          eq(studentClassrooms.studentId, studentId),
          eq(studentClassrooms.schoolYearId, schoolYearId)
        )
      );
  }
}
