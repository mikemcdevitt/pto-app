"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface StudentOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface ParentFormProps {
  allStudents: StudentOption[];
  initialData?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    studentIds: string[];
  };
}

interface PendingStudent {
  firstName: string;
  lastName: string;
  cohortYear: string; // kept as the raw input string, same as StudentForm
}

export default function ParentForm({ allStudents, initialData }: ParentFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialData);

  const [email, setEmail] = useState(initialData?.email ?? "");
  const [firstName, setFirstName] = useState(initialData?.firstName ?? "");
  const [lastName, setLastName] = useState(initialData?.lastName ?? "");
  const [studentIds, setStudentIds] = useState<string[]>(initialData?.studentIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // New students to create for this parent, staged locally and only
  // actually created (POST /api/students) when this form is submitted --
  // not the moment "Add Student" is clicked. That way, if saving the
  // parent fails (duplicate email, etc.), nothing gets created, and we
  // never end up with a student that exists but isn't linked to anyone.
  const [pendingNewStudents, setPendingNewStudents] = useState<PendingStudent[]>([]);
  const [newStudentFirstName, setNewStudentFirstName] = useState("");
  const [newStudentLastName, setNewStudentLastName] = useState("");
  const [newStudentCohortYear, setNewStudentCohortYear] = useState("");

  function toggleStudent(id: string) {
    setStudentIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function addPendingStudent() {
    if (!newStudentFirstName.trim() || !newStudentLastName.trim()) return;
    setPendingNewStudents((prev) => [
      ...prev,
      {
        firstName: newStudentFirstName.trim(),
        lastName: newStudentLastName.trim(),
        cohortYear: newStudentCohortYear,
      },
    ]);
    setNewStudentFirstName("");
    setNewStudentLastName("");
    setNewStudentCohortYear("");
  }

  function removePendingStudent(index: number) {
    setPendingNewStudents((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Create any staged new students first, so their ids can be included
    // in the same studentIds list sent below. If one fails partway
    // through, stop rather than saving the parent with only some of them
    // linked -- earlier ones in this batch may already exist unlinked at
    // that point, findable later with a "students with no parent" query.
    const newStudentIds: string[] = [];
    for (const pending of pendingNewStudents) {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: pending.firstName,
          lastName: pending.lastName,
          cohortYear: pending.cohortYear.trim() === "" ? null : Number(pending.cohortYear),
        }),
      });
      if (!res.ok) {
        setError(
          `Couldn't create new student "${pending.firstName} ${pending.lastName}". Nothing else was saved -- fix this and try again.`
        );
        setSubmitting(false);
        return;
      }
      const created = await res.json();
      newStudentIds.push(created.id);
    }

    const allStudentIds = [...studentIds, ...newStudentIds];

    const url = isEditing ? `/api/parents/${initialData!.id}` : "/api/parents";
    const method = isEditing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, firstName, lastName, studentIds: allStudentIds }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    router.push("/admin/parents");
    router.refresh();
  }

  async function handleDelete() {
    if (!isEditing) return;
    if (!confirm("Delete this parent? This can't be undone.")) return;

    setSubmitting(true);
    const res = await fetch(`/api/parents/${initialData!.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete. Please try again.");
      setSubmitting(false);
      return;
    }
    router.push("/admin/parents");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border rounded p-2"
        />
      </div>
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
        <label className="block text-sm font-medium mb-1">Children</label>
        <div className="border rounded p-2 max-h-48 overflow-y-auto space-y-1">
          {allStudents.length === 0 && pendingNewStudents.length === 0 && (
            <p className="text-sm text-gray-400">No students exist yet.</p>
          )}
          {allStudents.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={studentIds.includes(s.id)}
                onChange={() => toggleStudent(s.id)}
              />
              {s.firstName} {s.lastName}
            </label>
          ))}
        </div>

        {pendingNewStudents.length > 0 && (
          <ul className="mt-2 space-y-1">
            {pendingNewStudents.map((p, i) => (
              <li key={i} className="flex items-center justify-between text-sm bg-blue-50 rounded px-2 py-1">
                <span>
                  {p.firstName} {p.lastName}
                  {p.cohortYear.trim() !== "" && (
                    <span className="text-gray-500"> (cohort {p.cohortYear})</span>
                  )}
                  <span className="text-gray-400"> -- new, created on save</span>
                </span>
                <button
                  type="button"
                  onClick={() => removePendingStudent(i)}
                  className="text-red-600 text-xs"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 border-t pt-3">
          <p className="text-sm font-medium mb-1">Add a new student</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={newStudentFirstName}
              onChange={(e) => setNewStudentFirstName(e.target.value)}
              placeholder="First name"
              className="flex-1 min-w-[8rem] border rounded p-2 text-sm"
            />
            <input
              type="text"
              value={newStudentLastName}
              onChange={(e) => setNewStudentLastName(e.target.value)}
              placeholder="Last name"
              className="flex-1 min-w-[8rem] border rounded p-2 text-sm"
            />
            <input
              type="number"
              inputMode="numeric"
              value={newStudentCohortYear}
              onChange={(e) => setNewStudentCohortYear(e.target.value)}
              placeholder="Cohort (optional)"
              min={2000}
              max={2100}
              className="w-32 border rounded p-2 text-sm"
            />
            <button
              type="button"
              onClick={addPendingStudent}
              disabled={!newStudentFirstName.trim() || !newStudentLastName.trim()}
              className="px-3 py-2 border rounded text-sm disabled:opacity-50"
            >
              Add Student
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Created and linked to this parent when you {isEditing ? "save changes" : "create the parent"} below.
          </p>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {isEditing ? "Save Changes" : "Create Parent"}
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
