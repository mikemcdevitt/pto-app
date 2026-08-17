import { db } from "@/db";
import { parents, parentStudents, students } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import ParentForm from "../ParentForm";

export default async function EditParentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [parent] = await db.select().from(parents).where(eq(parents.id, id));
  if (!parent) notFound();

  const allStudents = await db.select().from(students).orderBy(asc(students.lastName), asc(students.firstName));

  const linked = await db
    .select({ studentId: parentStudents.studentId })
    .from(parentStudents)
    .where(eq(parentStudents.parentId, id));

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Edit Parent</h1>
      <ParentForm
        allStudents={allStudents}
        initialData={{ ...parent, studentIds: linked.map((l) => l.studentId) }}
      />
    </div>
  );
}