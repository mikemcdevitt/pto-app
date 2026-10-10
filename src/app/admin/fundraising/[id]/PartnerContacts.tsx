"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface LinkedContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  isCurrent: boolean;
}

interface Props {
  partnerId: string;
  linked: LinkedContact[];
  // Everyone in fundraising_contacts, for the "existing contact" picker.
  allContacts: { id: string; name: string; email: string | null }[];
}

export default function PartnerContacts({ partnerId, linked, allContacts }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingRoleFor, setEditingRoleFor] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState("");

  // Add form
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existingId, setExistingId] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newPrimary, setNewPrimary] = useState(linked.every((c) => !c.isPrimary));

  const current = linked.filter((c) => c.isCurrent).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const former = linked.filter((c) => !c.isCurrent);
  const linkedIds = new Set(linked.map((c) => c.id));
  const pickable = allContacts.filter((c) => !linkedIds.has(c.id));

  async function send(url: string, method: string, body?: unknown) {
    setError(null);
    setBusy(true);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return false;
    }
    router.refresh();
    return true;
  }

  const linkUrl = (contactId: string) => `/api/fundraising/partners/${partnerId}/contacts/${contactId}`;

  async function saveRole(contactId: string) {
    if (await send(linkUrl(contactId), "PATCH", { role: roleDraft })) setEditingRoleFor(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const payload =
      mode === "existing"
        ? { contactId: existingId, role: newRole, isPrimary: newPrimary }
        : { newContact: { name: newName, email: newEmail, phone: newPhone }, role: newRole, isPrimary: newPrimary };
    if (mode === "existing" && !existingId) {
      setError("Pick a contact.");
      return;
    }
    if (await send(`/api/fundraising/partners/${partnerId}/contacts`, "POST", payload)) {
      setExistingId("");
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setNewRole("");
      setNewPrimary(false);
    }
  }

  function row(c: LinkedContact) {
    return (
      <li key={c.id} className={`border rounded p-3 text-sm ${c.isCurrent ? "" : "bg-gray-50 text-gray-500"}`}>
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <p>
              <Link href={`/admin/fundraising/contacts/${c.id}`} className="font-medium hover:underline">
                {c.name}
              </Link>
              {c.isPrimary && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">primary</span>}
              {!c.isCurrent && <span className="ml-2 text-xs">former</span>}
            </p>
            {editingRoleFor === c.id ? (
              <div className="flex gap-2 mt-1">
                <input
                  value={roleDraft}
                  onChange={(e) => setRoleDraft(e.target.value)}
                  placeholder="Role, e.g. owner"
                  className="border rounded px-2 py-1 text-sm flex-1"
                  autoFocus
                />
                <button type="button" onClick={() => saveRole(c.id)} disabled={busy} className="px-2 py-1 border rounded text-xs">
                  Save
                </button>
                <button type="button" onClick={() => setEditingRoleFor(null)} className="px-2 py-1 text-xs text-gray-500">
                  Cancel
                </button>
              </div>
            ) : (
              <p className="text-gray-500">{c.role ?? <span className="italic text-gray-400">no role</span>}</p>
            )}
            <p className="flex flex-wrap gap-x-3 mt-1">
              {c.email && <a href={`mailto:${c.email}`} className="text-blue-600 break-all">{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone}`} className="text-blue-600">{c.phone}</a>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          {c.isCurrent && !c.isPrimary && (
            <button type="button" disabled={busy} onClick={() => send(linkUrl(c.id), "PATCH", { isPrimary: true })} className="text-blue-600">
              Make primary
            </button>
          )}
          {editingRoleFor !== c.id && (
            <button
              type="button"
              onClick={() => {
                setEditingRoleFor(c.id);
                setRoleDraft(c.role ?? "");
              }}
              className="text-blue-600"
            >
              Edit role
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => send(linkUrl(c.id), "PATCH", { isCurrent: !c.isCurrent })}
            className="text-blue-600"
          >
            {c.isCurrent ? "Mark as former" : "Mark as current"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm(`Remove ${c.name} from this partner? They stay in All Contacts.`)) send(linkUrl(c.id), "DELETE");
            }}
            className="text-red-600"
          >
            Remove
          </button>
        </div>
      </li>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Contacts</h2>
      {current.length === 0 && <p className="text-sm text-gray-400 mb-2">No current contact.</p>}
      <ul className="space-y-2">{current.map(row)}</ul>
      {former.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-gray-500 mt-4 mb-2">Former contacts</h3>
          <ul className="space-y-2">{former.map(row)}</ul>
        </>
      )}

      <form onSubmit={handleAdd} className="mt-4 border rounded p-3 space-y-2">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New person
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={pickable.length === 0}
            />{" "}
            Existing contact
          </label>
        </div>

        {mode === "existing" ? (
          <select value={existingId} onChange={(e) => setExistingId(e.target.value)} className="w-full border rounded p-2 text-sm">
            <option value="">Choose a person...</option>
            {pickable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.email ? ` (${c.email})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" required className="border rounded p-2 text-sm" />
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" className="border rounded p-2 text-sm" />
            <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone" className="border rounded p-2 text-sm" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Role here, e.g. owner"
            className="border rounded p-2 text-sm flex-1 min-w-[10rem]"
          />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={newPrimary} onChange={(e) => setNewPrimary(e.target.checked)} /> Primary
          </label>
          <button type="submit" disabled={busy} className="px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
            Add contact
          </button>
        </div>
      </form>

      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </section>
  );
}
