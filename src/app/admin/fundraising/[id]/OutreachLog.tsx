"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/fundraising";

export interface OutreachEntry {
  id: string;
  date: string | null;
  ptoMember: string | null;
  note: string;
  contactName: string | null;
}

interface Props {
  partnerId: string;
  entries: OutreachEntry[];
  contacts: { id: string; name: string }[]; // this partner's current contacts
  defaultPtoMember: string | null;
  currentFollowUpBy: string | null;
  today: string; // YYYY-MM-DD, computed on the server so it matches the render
}

export default function OutreachLog({ partnerId, entries, contacts, defaultPtoMember, currentFollowUpBy, today }: Props) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [ptoMember, setPtoMember] = useState(defaultPtoMember ?? "");
  const [contactId, setContactId] = useState("");
  const [note, setNote] = useState("");
  const [followUpBy, setFollowUpBy] = useState(currentFollowUpBy ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/fundraising/partners/${partnerId}/outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, ptoMember, contactId, note, followUpBy }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }
    setNote("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this log entry?")) return;
    setBusy(true);
    const res = await fetch(`/api/fundraising/outreach/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Failed to delete. Please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Outreach log</h2>

      <form onSubmit={handleSubmit} className="border rounded p-3 space-y-2 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="text-xs text-gray-600">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full border rounded p-2 text-sm" />
          </label>
          <label className="text-xs text-gray-600">
            PTO member
            <input
              value={ptoMember}
              onChange={(e) => setPtoMember(e.target.value)}
              placeholder="Who reached out"
              className="w-full border rounded p-2 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            With
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full border rounded p-2 text-sm">
              <option value="">(no specific person)</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          rows={2}
          placeholder="What happened -- emailed about a spring event, met the manager, waiting on reply..."
          className="w-full border rounded p-2 text-sm"
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            Next follow-up
            <input type="date" value={followUpBy} onChange={(e) => setFollowUpBy(e.target.value)} className="block border rounded p-2 text-sm" />
          </label>
          <button type="submit" disabled={busy} className="px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
            Log outreach
          </button>
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </form>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing logged yet.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="border-l-2 border-gray-200 pl-3 text-sm">
              <div className="flex justify-between gap-2">
                <p className="text-gray-500">
                  {e.date ? formatDate(e.date) : <span className="italic">Undated</span>}
                  {e.ptoMember && <> · {e.ptoMember}</>}
                  {e.contactName && <> → {e.contactName}</>}
                </p>
                <button type="button" onClick={() => handleDelete(e.id)} disabled={busy} className="text-xs text-red-600">
                  Delete
                </button>
              </div>
              <p className="whitespace-pre-wrap">{e.note}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
