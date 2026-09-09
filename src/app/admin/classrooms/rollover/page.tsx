import { db } from "@/db";
import { schoolYears } from "@/db/schema";
import { desc } from "drizzle-orm";
import RolloverForm from "../RolloverForm";

export default async function RolloverPage() {
  const years = await db.select().from(schoolYears).orderBy(desc(schoolYears.sortYear));

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Roll Over Classrooms to New Year</h1>
      <p className="px-6 text-gray-600 text-sm">
        Copies every classroom (grade, teacher, abbreviation) from one school year into another.
      </p>
      <RolloverForm years={years} />
    </div>
  );
}