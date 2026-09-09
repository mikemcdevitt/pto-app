import { db } from "@/db";
import { schoolYears } from "@/db/schema";
import { asc } from "drizzle-orm";
import ClassroomForm from "../ClassroomForm";

export default async function NewClassroomPage() {
  const years = await db.select().from(schoolYears).orderBy(asc(schoolYears.sortYear));

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Add Classroom</h1>
      <ClassroomForm schoolYears={years} />
    </div>
  );
}