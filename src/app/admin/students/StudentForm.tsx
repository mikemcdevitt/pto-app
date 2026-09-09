"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface StudentFormProps {
  initialData?: { id: string; firstName: string; lastName: string };
}

export default function StudentForm({ initialData }: StudentFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialData);

  const [firstName, setFirstName] = useState(initialData?.firstName ?? "");
  const [lastName, setLastName] = useState(initialData?.lastName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const url = isEditing ? `/api/students/${initialData!.id}` : "/api/students";
    const method = isEditing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName }),
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