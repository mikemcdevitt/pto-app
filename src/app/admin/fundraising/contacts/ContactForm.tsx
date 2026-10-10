"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ContactFormProps {
  initialData?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    notes: string | null;
  };
  linkedPartnerCount?: number;
}

export default function ContactForm({ initialData, linkedPartnerCount = 0 }: ContactFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialData);

  const [name, setName] = useState(initialData?.name ?? "");
  const [email, setEmail] = useState(initialData?.email ?? "");
  const [phone, setPhone] = useState(initialData?.phone ?? "");
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    const res = await fetch(isEditing ? `/api/fundraising/contacts/${initialData!.id}` : "/api/fundraising/contacts", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, notes }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }
    if (isEditing) {
      setSaved(true);
      router.refresh();
    } else {
      router.push(`/admin/fundraising/contacts/${data.id}`);
    }
  }

  async function handleDelete() {
    if (!isEditing) return;
    const where =
      linkedPartnerCount > 0
        ? ` They'll be removed from ${linkedPartnerCount} partner${linkedPartnerCount === 1 ? "" : "s"}.`
        : "";
    if (!confirm(`Delete ${initialData!.name}?${where} Outreach notes that mention them are kept. This can't be undone.`)) return;
    setSubmitting(true);
    const res = await fetch(`/api/fundraising/contacts/${initialData!.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete. Please try again.");
      setSubmitting(false);
      return;
    }
    router.push("/admin/fundraising/contacts");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full border rounded p-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded p-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Phone</label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded p-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="About the person -- best way to reach them, days they work"
          className="w-full border rounded p-2"
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {saved && <p className="text-green-700 text-sm">Saved.</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {isEditing ? "Save Changes" : "Create Contact"}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="px-4 py-2 border border-red-600 text-red-600 rounded disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
