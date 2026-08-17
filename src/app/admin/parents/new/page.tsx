import { db } from "@/db";
import { students } from "@/db/schema";
import { asc } from "drizzle-orm";
import ParentForm from "../ParentForm";

export default async function NewParentPage() {
  const allStudents = await db.select().from(students).orderBy(asc(students.lastName), asc(students.firstName));

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Add Parent</h1>
      <ParentForm allStudents={allStudents} />
    </div>
  );
}