import { db } from "@/db";
import { classrooms, schoolYears } from "@/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import YearFilter from "./YearFilter";

export default async function ClassroomsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: selectedYearId } = await searchParams;

  const years = await db
    .select()
    .from(schoolYears)
    .orderBy(desc(schoolYears.sortYear));

  // Default to the most recent school year if none selected
  const activeYearId = selectedYearId ?? years[0]?.id;

  const allClassrooms = await db
    .select({
      id: classrooms.id,
      grade: classrooms.grade,
      teacherName: classrooms.teacherName,
      abbreviation: classrooms.abbreviation,
      schoolYearLabel: schoolYears.label,
    })
    .from(classrooms)
    .innerJoin(schoolYears, eq(classrooms.schoolYearId, schoolYears.id))
    .where(activeYearId ? eq(classrooms.schoolYearId, activeYearId) : undefined)
    .orderBy(asc(classrooms.grade), asc(classrooms.abbreviation));

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Classrooms</h1>
        <Link href="/admin/classrooms/new" className="px-4 py-2 bg-blue-600 text-white rounded">
          Add Classroom
        </Link>
        <Link href="/admin/classrooms/rollover" className="px-4 py-2 border rounded">
          Roll Over to New Year
        </Link>
      </div>

      <YearFilter years={years} activeYearId={activeYearId} />

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">School Year</th>
            <th className="p-2">Grade</th>
            <th className="p-2">Teacher</th>
            <th className="p-2">Abbreviation</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {allClassrooms.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="p-2">{c.schoolYearLabel}</td>
              <td className="p-2 capitalize">{c.grade}</td>
              <td className="p-2">{c.teacherName}</td>
              <td className="p-2">{c.abbreviation}</td>
              <td className="p-2">
                <Link href={`/admin/classrooms/${c.id}`} className="text-blue-600">
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {allClassrooms.length === 0 && (
        <p className="text-gray-500 mt-4">No classrooms for this school year yet.</p>
      )}
    </div>
  );
}