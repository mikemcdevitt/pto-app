import { db } from "@/db";
import { parentStudents, students } from "@/db/schema";
import { requireParentPage } from "@/lib/require-parent";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import StudentEditForm from "./StudentEditForm";

export default async function ParentEditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { parent } = await requireParentPage();
  const { id } = await params;

  // Confirm this student is actually linked to this parent before showing anything
  const [link] = await db
    .select()
    .from(parentStudents)
    .where(and(eq(parentStudents.parentId, parent.id), eq(parentStudents.studentId, id)));
  if (!link) notFound();

  const [student] = await db.select().from(students).where(eq(students.id, id));
  if (!student) notFound();

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Edit Student</h1>
      <StudentEditForm student={student} />
    </div>
  );
}