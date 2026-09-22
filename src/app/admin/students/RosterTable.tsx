"use client";

import { useState } from "react";
import Link from "next/link";
import { GRADE_LABEL, type Grade, type CohortStatus } from "@/lib/grades";

interface ClassroomOption {
  id: string;
  teacherName: string;
  abbreviation: string;
  grade: Grade;
}

interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  status: CohortStatus;
  classroomId: string | null;
}

interface RosterTableProps {
  students: RosterStudent[];
  classroomsByGrade: Partial<Record<Grade, ClassroomOption[]>>;
  selectedSchoolYearId: string;
}

function statusLabel(status: CohortStatus): string {
  switch (status.kind) {
    case "grade":
      return GRADE_LABEL[status.grade];
    case "graduated":
      return "Graduated";
    case "not-yet":
      return "Not yet enrolled";
    case "unknown":
      return "No cohort set";
  }
}

// Interactive roster table: one row per student, with an inline classroom
// picklist scoped to that row's own expected grade. Edits save immediately
// (optimistic UI, reverted on failure) via a dedicated endpoint that only
// touches the classroom assignment -- no need to resend name/cohort.
export default function RosterTable({
  students,
  classroomsByGrade,
  selectedSchoolYearId,
}: RosterTableProps) {
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(students.map((s) => [s.id, s.classroomId ?? ""]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  async function handleChange(studentId: string, classroomId: string) {
    const previous = assignments[studentId] ?? "";
    setAssignments((a) => ({ ...a, [studentId]: classroomId }));
    setRowErrors((e) => ({ ...e, [studentId]: "" }));
    setSavingId(studentId);

    const res = await fetch(`/api/students/${studentId}/classroom`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolYearId: selectedSchoolYearId,
        classroomId: classroomId || null,
      }),
    });

    setSavingId(null);
    if (!res.ok) {
      setAssignments((a) => ({ ...a, [studentId]: previous }));
      setRowErrors((e) => ({ ...e, [studentId]: "Failed to save" }));
    }
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="text-left border-b">
          <th className="p-2">Name</th>
          <th className="p-2">Grade</th>
          <th className="p-2">Classroom</th>
          <th className="p-2"></th>
        </tr>
      </thead>
      <tbody>
        {students.map((s) => {
          const eligible = s.status.kind === "grade" ? classroomsByGrade[s.status.grade] ?? [] : [];
          return (
            <tr key={s.id} className="border-b align-top">
              <td className="p-2">
                {s.firstName} {s.lastName}
              </td>
              <td className="p-2">
                {s.status.kind === "grade" ? (
                  statusLabel(s.status)
                ) : (
                  <span className="text-gray-400">{statusLabel(s.status)}</span>
                )}
              </td>
              <td className="p-2">
                {s.status.kind !== "grade" ? (
                  <span className="text-gray-400">—</span>
                ) : eligible.length === 0 ? (
                  <span className="text-xs text-gray-400">
                    No {GRADE_LABEL[s.status.grade]} classrooms set up yet
                  </span>
                ) : (
                  <>
                    <select
                      value={assignments[s.id] ?? ""}
                      onChange={(e) => handleChange(s.id, e.target.value)}
                      disabled={savingId === s.id}
                      className="border rounded p-1"
                    >
                      <option value="">— Unassigned —</option>
                      {eligible.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.teacherName} ({c.abbreviation})
                        </option>
                      ))}
                    </select>
                    {rowErrors[s.id] && (
                      <span className="text-red-600 text-xs ml-2">{rowErrors[s.id]}</span>
                    )}
                  </>
                )}
              </td>
              <td className="p-2">
                <Link href={`/admin/students/${s.id}`} className="text-blue-600">
                  Edit
                </Link>
              </td>
            </tr>
          );
        })}
        {students.length === 0 && (
          <tr>
            <td className="p-4 text-gray-400" colSpan={4}>
              No students match this view.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
