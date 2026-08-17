import { auth } from "@/auth";
import { db } from "@/db";
import { parents, parentStudents, students, studentClassrooms, classrooms, schoolYears } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export default async function ParentDashboardPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();

  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.email, email!));

  // Most recent school year, for showing each child's current classroom
  const [currentYear] = await db
    .select()
    .from(schoolYears)
    .orderBy(desc(schoolYears.sortYear))
    .limit(1);

  const children = await db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      grade: classrooms.grade,
      teacherName: classrooms.teacherName,
      abbreviation: classrooms.abbreviation,
    })
    .from(parentStudents)
    .innerJoin(students, eq(parentStudents.studentId, students.id))
    .leftJoin(
      studentClassrooms,
      and(
        eq(studentClassrooms.studentId, students.id),
        eq(studentClassrooms.schoolYearId, currentYear?.id ?? "")
      )
    )
    .leftJoin(classrooms, eq(studentClassrooms.classroomId, classrooms.id))
    .where(eq(parentStudents.parentId, parent?.id ?? ""));

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">
        Welcome{session?.user?.name ? `, ${session.user.name}` : ""}
      </h1>

      <h2 className="text-xl font-semibold mt-6 mb-3">My Children</h2>

      {children.length === 0 ? (
        <p className="text-gray-500">
          No children are linked to your account yet. Contact your PTO board if this seems wrong.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {children.map((child) => (
            <div key={child.id} className="border rounded-lg p-4 shadow-sm">
              <p className="font-semibold text-lg">
                {child.firstName} {child.lastName}
              </p>
              {child.grade ? (
                <>
                  <p className="text-sm text-gray-600 capitalize mt-1">
                    {child.grade} grade
                  </p>
                  <p className="text-sm text-gray-600">
                    {child.teacherName} ({child.abbreviation})
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-400 mt-1">
                  Not yet assigned to a classroom{currentYear ? ` for ${currentYear.label}` : ""}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}