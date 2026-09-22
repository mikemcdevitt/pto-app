import { db } from "@/db";
import { classrooms, schoolYears } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import ClassroomForm from "../ClassroomForm";

export default async function EditClassroomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [classroom] = await db.select().from(classrooms).where(eq(classrooms.id, id));
  if (!classroom) notFound();

  const years = await db.select().from(schoolYears).orderBy(desc(schoolYears.sortYear));

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Edit Classroom</h1>
      <ClassroomForm schoolYears={years} initialData={classroom} />
    </div>
  );
}