"use client";

import { useState } from "react";

interface ResolveResult {
  rowIndex: number;
  firstName: string;
  lastName: string;
  email: string;
  parentId?: string;
  currentFirstName?: string;
  currentLastName?: string;
  matchedParents?: { id: string; email: string }[];
  status: "update" | "no-change" | "possible-email-change" | "new" | "error";
  issues: string[];
}

interface RawRow {
  rowIndex: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface Override {
  firstName: string;
  lastName: string;
  email: string;
}

// Splits pasted/loaded text into rows without a real CSV parser -- good
// enough for First Name, Last Name, Email with no embedded delimiters in
// the values. Detects tab vs. comma per line (Excel paste is
// tab-separated; a .csv file is comma-separated) and skips a
// "First Name, Last Name, ..." header row if one is present.
//
// A roster export often lists the same parent once per child, so once
// rows are split out, duplicates -- same email, first name, and last
// name (case-insensitive) -- are collapsed to one before matching ever
// sees them. Otherwise an unchanged parent would show up as several
// identical "already up to date" rows, and a brand-new one as several
// separate "create" candidates that'd try to insert the same parent
// (and email) more than once.
function parseRows(text: string): RawRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

  const splitLine = (line: string) => {
    const delimiter = line.includes("\t") ? "\t" : ",";
    return line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
  };

  let dataLines = lines;
  if (lines.length > 0) {
    const firstCells = splitLine(lines[0]).map((c) => c.toLowerCase());
    if (firstCells[0] === "first name" && firstCells[1] === "last name") {
      dataLines = lines.slice(1);
    }
  }

  const seen = new Set<string>();
  const deduped: { firstName: string; lastName: string; email: string }[] = [];
  for (const line of dataLines) {
    const cells = splitLine(line);
    const firstName = cells[0] ?? "";
    const lastName = cells[1] ?? "";
    const email = cells[2] ?? "";
    const key = `${email.trim().toLowerCase()}|${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ firstName, lastName, email });
  }

  return deduped.map((row, i) => ({ rowIndex: i, ...row }));
}

export default function BulkUpdateForm() {
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [results, setResults] = useState<ResolveResult[] | null>(null);
  const [checkedUpdates, setCheckedUpdates] = useState<Set<number>>(new Set());
  const [checkedCreates, setCheckedCreates] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ updated: number; created: number; errors: string[] } | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRawText(await file.text());
    e.target.value = ""; // so picking the same file again still fires onChange
  }

  async function handlePreview() {
    setError(null);
    setResults(null);
    setApplyResult(null);

    const rows = parseRows(rawText);
    if (rows.length === 0) {
      setError("Paste some rows, or load a CSV file, first.");
      return;
    }

    setLoadingPreview(true);
    const res = await fetch("/api/parents/bulk-update/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    setLoadingPreview(false);

    if (!res.ok) {
      setError("Something went wrong checking these rows. Please try again.");
      return;
    }

    const data = await res.json();
    setResults(data.results);
    setCheckedUpdates(
      new Set(data.results.filter((r: ResolveResult) => r.status === "update").map((r: ResolveResult) => r.rowIndex))
    );
    setCheckedCreates(new Set());
    setOverrides(
      Object.fromEntries(
        data.results
          .filter((r: ResolveResult) => r.status === "new")
          .map((r: ResolveResult) => [r.rowIndex, { firstName: r.firstName, lastName: r.lastName, email: r.email }])
      )
    );
  }

  function toggleUpdate(rowIndex: number) {
    setCheckedUpdates((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function toggleCreate(rowIndex: number) {
    setCheckedCreates((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function updateOverride(rowIndex: number, patch: Partial<Override>) {
    setOverrides((prev) => ({ ...prev, [rowIndex]: { ...prev[rowIndex], ...patch } }));
  }

  async function handleApply() {
    if (!results) return;
    setApplying(true);
    setError(null);

    const updates = results
      .filter((r) => r.status === "update" && checkedUpdates.has(r.rowIndex))
      .map((r) => ({ parentId: r.parentId!, firstName: r.firstName, lastName: r.lastName }));

    const creates = results
      .filter((r) => r.status === "new" && checkedCreates.has(r.rowIndex))
      .map((r) => overrides[r.rowIndex])
      .filter((o): o is Override => Boolean(o));

    const res = await fetch("/api/parents/bulk-update/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates, creates }),
    });
    setApplying(false);

    if (!res.ok) {
      setError("Applying failed. Please try again.");
      return;
    }

    setApplyResult(await res.json());
    setResults(null);
    setRawText("");
  }

  const updateRows = (results ?? []).filter((r) => r.status === "update");
  const noChangeRows = (results ?? []).filter((r) => r.status === "no-change");
  const possibleEmailChangeRows = (results ?? []).filter((r) => r.status === "possible-email-change");
  const errorRows = (results ?? []).filter((r) => r.status === "error");
  const newRows = (results ?? []).filter((r) => r.status === "new");

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">
          Paste rows (from Excel), or load a CSV file below
        </label>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={8}
          placeholder={"First Name\tLast Name\tEmail\nAlex\tRivera\talex.rivera@example.com"}
          className="w-full border rounded p-2 font-mono text-sm"
        />
        <input type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} className="mt-2 text-sm" />
        <p className="text-xs text-gray-500 mt-1">
          A CSV file is read in your browser and never uploaded anywhere -- only the matches you
          approve below ever get saved.
        </p>
      </div>

      <button
        type="button"
        onClick={handlePreview}
        disabled={loadingPreview}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {loadingPreview ? "Checking…" : "Check Against Database"}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {applyResult && (
        <p className="text-sm bg-green-50 border border-green-200 rounded p-2">
          Updated {applyResult.updated}, created {applyResult.created}.
          {applyResult.errors.length > 0 && (
            <>
              {" "}
              {applyResult.errors.length} error(s):
              <ul className="list-disc ml-5">
                {applyResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </>
          )}
        </p>
      )}

      {results && (
        <div className="space-y-6">
          {updateRows.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Name updates ({updateRows.length})</h2>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="p-2"></th>
                    <th className="p-2">Email</th>
                    <th className="p-2">Current Name</th>
                    <th className="p-2">New Name</th>
                  </tr>
                </thead>
                <tbody>
                  {updateRows.map((r) => (
                    <tr key={r.rowIndex} className="border-b">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={checkedUpdates.has(r.rowIndex)}
                          onChange={() => toggleUpdate(r.rowIndex)}
                        />
                      </td>
                      <td className="p-2">{r.email}</td>
                      <td className="p-2">
                        {r.currentFirstName} {r.currentLastName}
                      </td>
                      <td className="p-2">
                        {r.firstName} {r.lastName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {newRows.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">No matching parent on file ({newRows.length})</h2>
              <p className="text-xs text-gray-500 mb-2">
                Unchecked by default -- review and edit before creating any of these. A newly
                created parent here has no family or student link yet; add that by hand
                afterward via Edit Parent.
              </p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="p-2"></th>
                    <th className="p-2">First Name</th>
                    <th className="p-2">Last Name</th>
                    <th className="p-2">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {newRows.map((r) => {
                    const o = overrides[r.rowIndex];
                    if (!o) return null;
                    return (
                      <tr key={r.rowIndex} className="border-b">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={checkedCreates.has(r.rowIndex)}
                            onChange={() => toggleCreate(r.rowIndex)}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={o.firstName}
                            onChange={(e) => updateOverride(r.rowIndex, { firstName: e.target.value })}
                            className="border rounded p-1 w-28"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={o.lastName}
                            onChange={(e) => updateOverride(r.rowIndex, { lastName: e.target.value })}
                            className="border rounded p-1 w-28"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="email"
                            value={o.email}
                            onChange={(e) => updateOverride(r.rowIndex, { email: e.target.value })}
                            className="border rounded p-1 w-48"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {(possibleEmailChangeRows.length > 0 || errorRows.length > 0) && (
            <section>
              <h2 className="font-semibold mb-2">
                Needs attention ({possibleEmailChangeRows.length + errorRows.length})
              </h2>
              <p className="text-xs text-gray-500 mb-2">
                Not applied -- review by hand (Edit Parent for an address change) and re-check if
                you fix the source data.
              </p>
              <ul className="text-sm space-y-1">
                {[...possibleEmailChangeRows, ...errorRows].map((r) => (
                  <li key={r.rowIndex} className="text-amber-700">
                    {r.firstName} {r.lastName} ({r.email}): {r.issues.join("; ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {noChangeRows.length > 0 && (
            <details className="text-sm text-gray-500">
              <summary>{noChangeRows.length} already up to date</summary>
              <ul className="mt-2 space-y-1">
                {noChangeRows.map((r) => (
                  <li key={r.rowIndex}>
                    {r.firstName} {r.lastName} ({r.email})
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(updateRows.length > 0 || newRows.length > 0) && (
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            >
              {applying ? "Applying…" : "Apply Checked Changes"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
