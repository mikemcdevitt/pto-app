"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FUNDRAISING_STATUSES, STATUS_LABELS, type FundraisingStatus } from "@/lib/fundraising";

interface PartnerFormProps {
  initialData?: {
    id: string;
    name: string;
    status: FundraisingStatus;
    website: string | null;
    ptoOwner: string | null;
    followUpBy: string | null;
    notes: string | null;
  };
}

export default function PartnerForm({ initialData }: PartnerFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialData);

  const [name, setName] = useState(initialData?.name ?? "");
  const [status, setStatus] = useState<FundraisingStatus>(initialData?.status ?? "prospective");
  const [website, setWebsite] = useState(initialData?.website ?? "");
  const [ptoOwner, setPtoOwner] = useState(initialData?.ptoOwner ?? "");
  const [followUpBy, setFollowUpBy] = useState(initialData?.followUpBy ?? "");
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);

    const res = await fetch(isEditing ? `/api/fundraising/partners/${initialData!.id}` : "/api/fundraising/partners", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, status, website, ptoOwner, followUpBy, notes }),
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
      // Straight to the new partner's page so contacts can be added.
      router.push(`/admin/fundraising/${data.id}`);
    }
  }

  async function handleDelete() {
    if (!isEditing) return;
    if (
      !confirm(
        `Delete ${initialData!.name}? Its contact links and outreach log go with it (the people stay in All Contacts). To keep the history, set the status to Inactive instead.`
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/fundraising/partners/${initialData!.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete. Please try again.");
      setSubmitting(false);
      return;
    }
    router.push("/admin/fundraising");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Business name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border rounded p-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as FundraisingStatus)}
          className="w-full border rounded p-2"
        >
          {FUNDRAISING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Website</label>
        <input
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="example.com"
          className="w-full border rounded p-2"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">PTO owner</label>
          <input
            type="text"
            value={ptoOwner}
            onChange={(e) => setPtoOwner(e.target.value)}
            placeholder="Who's handling this"
            className="w-full border rounded p-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Follow up by</label>
          <input
            type="date"
            value={followUpBy}
            onChange={(e) => setFollowUpBy(e.target.value)}
            className="w-full border rounded p-2"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Durable notes about the relationship -- what they offer, what's worked"
          className="w-full border rounded p-2"
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {saved && <p className="text-green-700 text-sm">Saved.</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {isEditing ? "Save Changes" : "Create Partner"}
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
