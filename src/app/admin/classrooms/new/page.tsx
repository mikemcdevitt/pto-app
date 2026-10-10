import { db } from "@/db";
import { schoolYears } from "@/db/schema";
import { desc } from "drizzle-orm";
import ClassroomForm from "../ClassroomForm";
import { requireAdminPage } from "@/lib/require-admin";

export default async function NewClassroomPage() {
  await requireAdminPage();
  const years = await db.select().from(schoolYears).orderBy(desc(schoolYears.sortYear));

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Add Classroom</h1>
      <ClassroomForm schoolYears={years} />
    </div>
  );
}