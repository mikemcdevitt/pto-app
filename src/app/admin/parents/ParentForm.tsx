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

export default function ParentForm({ allStudents, initialData }: ParentFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialData);

  const [email, setEmail] = useState(initialData?.email ?? "");
  const [firstName, setFirstName] = useState(initialData?.firstName ?? "");
  const [lastName, setLastName] = useState(initialData?.lastName ?? "");
  const [studentIds, setStudentIds] = useState<string[]>(initialData?.studentIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleStudent(id: string) {
    setStudentIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const url = isEditing ? `/api/parents/${initialData!.id}` : "/api/parents";
    const method = isEditing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, firstName, lastName, studentIds }),
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
          {allStudents.length === 0 && (
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