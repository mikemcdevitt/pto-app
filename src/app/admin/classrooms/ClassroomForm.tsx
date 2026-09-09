"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const GRADES = [
  "kindergarten",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
] as const;

interface SchoolYear {
  id: string;
  label: string;
}

interface ClassroomFormProps {
  schoolYears: SchoolYear[];
  initialData?: {
    id: string;
    schoolYearId: string;
    grade: string;
    teacherName: string;
    abbreviation: string;
  };
}

export default function ClassroomForm({ schoolYears, initialData }: ClassroomFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialData);

  const [schoolYearId, setSchoolYearId] = useState(
    initialData?.schoolYearId ?? schoolYears[0]?.id ?? ""
  );
  const [grade, setGrade] = useState(initialData?.grade ?? "kindergarten");
  const [teacherName, setTeacherName] = useState(initialData?.teacherName ?? "");
  const [abbreviation, setAbbreviation] = useState(initialData?.abbreviation ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const url = isEditing ? `/api/classrooms/${initialData!.id}` : "/api/classrooms";
    const method = isEditing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolYearId, grade, teacherName, abbreviation }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    router.push("/admin/classrooms");
    router.refresh();
  }

  async function handleDelete() {
    if (!isEditing) return;
    if (!confirm("Delete this classroom? This can't be undone.")) return;

    setSubmitting(true);
    const res = await fetch(`/api/classrooms/${initialData!.id}`, { method: "DELETE" });

    if (!res.ok) {
      setError("Failed to delete. Please try again.");
      setSubmitting(false);
      return;
    }

    router.push("/admin/classrooms");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">School Year</label>
        {isEditing ? (
          <p className="p-2 border rounded bg-gray-50 text-gray-700">
            {schoolYears.find((y) => y.id === schoolYearId)?.label}
          </p>
        ) : (
          <select
            value={schoolYearId}
            onChange={(e) => setSchoolYearId(e.target.value)}
            className="w-full border rounded p-2"
          >
            {schoolYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Grade</label>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="w-full border rounded p-2 capitalize"
        >
          {GRADES.map((g) => (
            <option key={g} value={g} className="capitalize">
              {g}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Teacher Name</label>
        <input
          type="text"
          value={teacherName}
          onChange={(e) => setTeacherName(e.target.value)}
          required
          className="w-full border rounded p-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Abbreviation</label>
        <input
          type="text"
          value={abbreviation}
          onChange={(e) => setAbbreviation(e.target.value.toUpperCase())}
          required
          maxLength={10}
          className="w-full border rounded p-2"
          placeholder="e.g. KCC"
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {isEditing ? "Save Changes" : "Create Classroom"}
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