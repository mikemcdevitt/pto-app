"use client";

import { useState } from "react";

interface SchoolYear {
  id: string;
  label: string;
}

export default function RolloverForm({ years }: { years: SchoolYear[] }) {
  const [fromYearId, setFromYearId] = useState(years[1]?.id ?? years[0]?.id ?? "");
  const [toYearId, setToYearId] = useState(years[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    const res = await fetch("/api/classrooms/rollover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromYearId, toYearId }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }

    setResult(
      `Copied ${data.copied} classroom(s).` +
        (data.skipped > 0 ? ` ${data.skipped} already existed and were skipped.` : "")
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">From School Year</label>
        <select value={fromYearId} onChange={(e) => setFromYearId(e.target.value)} className="w-full border rounded p-2">
          {years.map((y) => (
            <option key={y.id} value={y.id}>{y.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">To School Year</label>
        <select value={toYearId} onChange={(e) => setToYearId(e.target.value)} className="w-full border rounded p-2">
          {years.map((y) => (
            <option key={y.id} value={y.id}>{y.label}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {result && <p className="text-green-700 text-sm">{result}</p>}

      <button
        type="submit"
        disabled={submitting || fromYearId === toYearId}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {submitting ? "Rolling over..." : "Roll Over Classrooms"}
      </button>
    </form>
  );
}