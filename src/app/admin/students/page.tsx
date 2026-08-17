import { db } from "@/db";
import { students } from "@/db/schema";
import { asc } from "drizzle-orm";
import Link from "next/link";

export default async function StudentsPage() {
  const allStudents = await db.select().from(students).orderBy(asc(students.lastName), asc(students.firstName));

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Students</h1>
        <Link href="/admin/students/new" className="px-4 py-2 bg-blue-600 text-white rounded">
          Add Student
        </Link>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">Name</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {allStudents.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-2">{s.firstName} {s.lastName}</td>
              <td className="p-2">
                <Link href={`/admin/students/${s.id}`} className="text-blue-600">Edit</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}