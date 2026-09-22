"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GRADE_LABEL, gradeForCohortInSchoolYear, type Grade } from "@/lib/grades";

interface ClassroomOption {
  id: string;
  teacherName: string;
  abbreviation: string;
  grade: Grade;
}

interface StudentFormProps {
  initialData?: {
    id: string;
    firstName: string;
    lastName: string;
    cohortYear: number | null;
  };
  // Present only on the Edit Student page: the current school year plus
  // every classroom in it, so the classroom picklist below can filter
  // live as the admin edits the cohort year, without a round trip.
  currentSchoolYear?: { id: string; label: string; sortYear: number };
  classroomsForYear?: ClassroomOption[];
  currentClassroomId?: string | null;
}

export default function StudentForm({
  initialData,
  currentSchoolYear,
  classroomsForYear = [],
  currentClassroomId = null,
}: StudentFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialData);

  const [firstName, setFirstName] = useState(initialData?.firstName ?? "");
  const [lastName, setLastName] = useState(initialData?.lastName ?? "");
  const [cohortYear, setCohortYear] = useState(
    initialData?.cohortYear != null ? String(initialData.cohortYear) : ""
  );
  const [classroomId, setClassroomId] = useState(currentClassroomId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const expectedGrade = useMemo(() => {
    if (!currentSchoolYear) return null;
    const year = Number(cohortYear);
    if (!cohortYear.trim() || Number.isNaN(year)) return null;
    return gradeForCohortInSchoolYear(year, currentSchoolYear.sortYear);
  }, [cohortYear, currentSchoolYear]);

  const eligibleClassrooms = useMemo(
    () =>
      expectedGrade
        ? classroomsForYear.filter((c) => c.grade === expectedGrade)
        : [],
    [classroomsForYear, expectedGrade]
  );

  // If the admin changes the cohort year such that the previously-picked
  // classroom no longer matches the newly-expected grade, treat the
  // selection as unset (derived at render time, not synced via an effect)
  // rather than silently submitting a mismatched classroom. The original
  // pick in `classroomId` isn't destroyed, so it reappears if they change
  // the cohort year back.
  const selectedClassroomId = eligibleClassrooms.some((c) => c.id === classroomId)
    ? classroomId
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const url = isEditing ? `/api/students/${initialData!.id}` : "/api/students";
    const method = isEditing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        cohortYear: cohortYear.trim() === "" ? null : Number(cohortYear),
        ...(currentSchoolYear
          ? { schoolYearId: currentSchoolYear.id, classroomId: selectedClassroomId || null }
          : {}),
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    router.push("/admin/students");
    router.refresh();
  }

  async function handleDelete() {
    if (!isEditing) return;
    if (!confirm("Delete this student? This can't be undone.")) return;

    setSubmitting(true);
    const res = await fetch(`/api/students/${initialData!.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete. Please try again.");
      setSubmitting(false);
      return;
    }
    router.push("/admin/students");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">First Name</label>
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
          className="w-full border rounded p-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Last Name</label>
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
          className="w-full border rounded p-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Cohort</label>
        <input
          type="number"
          inputMode="numeric"
          value={cohortYear}
          onChange={(e) => setCohortYear(e.target.value)}
          placeholder="e.g. 2031"
          min={2000}
          max={2100}
          className="w-full border rounded p-2"
        />
        <p className="text-xs text-gray-500 mt-1">
          The year of the summer this student is expected to finish 5th grade.
        </p>
      </div>

      {currentSchoolYear && (
        <div>
          <label className="block text-sm font-medium mb-1">
            Classroom ({currentSchoolYear.label})
          </label>
          {!cohortYear.trim() ? (
            <p className="text-sm text-gray-500">
              Set a cohort year above to see eligible classrooms.
            </p>
          ) : !expectedGrade ? (
            <p className="text-sm text-gray-500">
              This cohort isn&apos;t in K&ndash;5 during {currentSchoolYear.label} &mdash; no
              classroom to assign.
            </p>
          ) : eligibleClassrooms.length === 0 ? (
            <p className="text-sm text-gray-500">
              No {GRADE_LABEL[expectedGrade]} classrooms have been set up for{" "}
              {currentSchoolYear.label} yet.
            </p>
          ) : (
            <select
              value={selectedClassroomId}
              onChange={(e) => setClassroomId(e.target.value)}
              className="w-full border rounded p-2"
            >
              <option value="">&mdash; Unassigned &mdash;</option>
              {eligibleClassrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.teacherName} ({c.abbreviation})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {isEditing ? "Save Changes" : "Create Student"}
        </button>
        {isEditing && (
          <button type="button" onClick={handleDelete} disabled={submitting} className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50">
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
