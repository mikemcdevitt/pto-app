import { db } from "@/db";
import { parents } from "@/db/schema";
import { asc } from "drizzle-orm";
import Link from "next/link";

export default async function ParentsPage() {
  const allParents = await db.select().from(parents).orderBy(asc(parents.lastName), asc(parents.firstName));

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Parents</h1>
        <Link href="/admin/parents/new" className="px-4 py-2 bg-blue-600 text-white rounded">
          Add Parent
        </Link>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">Name</th>
            <th className="p-2">Email</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {allParents.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="p-2">{p.firstName} {p.lastName}</td>
              <td className="p-2">{p.email}</td>
              <td className="p-2">
                <Link href={`/admin/parents/${p.id}`} className="text-blue-600">Edit</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}