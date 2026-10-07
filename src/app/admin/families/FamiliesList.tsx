"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

interface FamilyParent {
  parentId: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface FamilyStudent {
  studentId: string;
  firstName: string;
  lastName: string;
}

interface FamilyRow {
  id: string;
  name: string | null;
  parents: FamilyParent[];
  students: FamilyStudent[];
}

interface FamiliesListProps {
  families: FamilyRow[];
}

function matchesQuery(family: FamilyRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    family.students.some((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q)) ||
    family.parents.some((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
  );
}

// Read-only grouping of parents and students by family, kept in the
// default (last name of the eldest-alphabetically child) order the
// server already sorted -- search only filters that list down, it
// never re-sorts it.
export default function FamiliesList({ families }: FamiliesListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => families.filter((f) => matchesQuery(f, query)),
    [families, query]
  );

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by student or parent name…"
        className="w-full max-w-sm border rounded p-2 text-sm"
      />

      {families.length === 0 ? (
        <p className="text-gray-500">No families on file yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">No families match &quot;{query}&quot;.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Family</th>
              <th className="p-2">Children</th>
              <th className="p-2">Parents</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.id} className="border-b align-top">
                <td className="p-2 font-medium">{f.name || "—"}</td>
                <td className="p-2">
                  {f.students.length === 0 ? (
                    <span className="text-gray-400">None on file</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {f.students.map((s) => (
                        <li key={s.studentId}>
                          <Link href={`/admin/students/${s.studentId}`} className="text-blue-600">
                            {s.firstName} {s.lastName}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="p-2">
                  {f.parents.length === 0 ? (
                    <span className="text-gray-400">None on file</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {f.parents.map((p) => (
                        <li key={p.parentId}>
                          <Link href={`/admin/parents/${p.parentId}`} className="text-blue-600">
                            {p.firstName} {p.lastName}
                          </Link>{" "}
                          <span className="text-gray-500 text-xs">{p.email}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
