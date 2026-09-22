import { db } from "@/db";
import { students } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
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

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Edit Student</h1>
      <StudentForm initialData={student} />
    </div>
  );
}