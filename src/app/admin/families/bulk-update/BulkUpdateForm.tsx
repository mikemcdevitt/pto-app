"use client";

import { useState } from "react";

interface SchoolYearOption {
  id: string;
  label: string;
  sortYear: number;
}

interface RawParentSlot {
  firstName: string;
  lastName: string;
  email: string;
}

interface RawRow {
  rowIndex: number;
  childFirstName: string;
  childLastName: string;
  classroomAbbr: string;
  parents: RawParentSlot[];
}

interface ParentSlotResult {
  position: number;
  firstName: string;
  lastName: string;
  email: string;
  parentId?: string;
  status: "matched" | "not-found" | "conflict";
}

interface AddLinks {
  familyId: string;
  addStudentLink: boolean;
  addParentIds: string[];
}

interface ResolveResult {
  rowIndex: number;
  childFirstName: string;
  childLastName: string;
  classroomAbbr: string;
  studentId?: string;
  studentStatus: "matched" | "not-found" | "ambiguous";
  parents: ParentSlotResult[];
  status: "update" | "no-change" | "attention" | "error" | "create-family";
  issues: string[];
  addLinks?: AddLinks;
  createGroupKey?: string;
}

interface CreateGroup {
  groupKey: string;
  parentIds: string[];
  parentNames: string[];
  students: { studentId: string; name: string }[];
  rowIndexes: number[];
  suggestedName: string | null;
}

interface BulkUpdateFormProps {
  schoolYears: SchoolYearOption[];
}

// Splits pasted/loaded text into rows without a real CSV parser -- good
// enough for this export, which has no embedded delimiters in the
// values. Detects tab vs. comma per line (Excel paste is
// tab-separated; a .csv file is comma-separated) and skips a header
// row if one is present. After the fixed Child First/Last/Classroom
// columns, every further group of three cells is one parent's First
// Name, Last Name, Email -- as many groups as the row has.
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
    const firstLineLower = lines[0].toLowerCase();
    if (firstLineLower.includes("email") && firstLineLower.includes("name")) {
      dataLines = lines.slice(1);
    }
  }

  const rows: RawRow[] = [];
  dataLines.forEach((line) => {
    const cells = splitLine(line);
    const childFirstName = cells[0] ?? "";
    const childLastName = cells[1] ?? "";
    const classroomAbbr = cells[2] ?? "";
    if (childFirstName === "" && childLastName === "") return;

    const parents: RawParentSlot[] = [];
    for (let base = 3; base < cells.length; base += 3) {
      const firstName = cells[base] ?? "";
      const lastName = cells[base + 1] ?? "";
      const email = cells[base + 2] ?? "";
      if (firstName === "" && lastName === "" && email === "") continue;
      parents.push({ firstName, lastName, email });
    }

    rows.push({ rowIndex: rows.length, childFirstName, childLastName, classroomAbbr, parents });
  });

  return rows;
}

function parentSummary(parents: ParentSlotResult[]): string {
  return parents
    .map((p) => {
      const name = `${p.firstName} ${p.lastName}`.trim() || p.email;
      if (p.status === "matched") return name;
      if (p.status === "conflict") return `${name} (conflict)`;
      return `${name} (no match)`;
    })
    .join(", ");
}

export default function BulkUpdateForm({ schoolYears }: BulkUpdateFormProps) {
  const [schoolYearId, setSchoolYearId] = useState(schoolYears[0]?.id ?? "");
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [results, setResults] = useState<ResolveResult[] | null>(null);
  const [createGroups, setCreateGroups] = useState<CreateGroup[]>([]);
  const [checkedUpdates, setCheckedUpdates] = useState<Set<number>>(new Set());
  const [checkedGroups, setCheckedGroups] = useState<Set<string>>(new Set());
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ linksAdded: number; familiesCreated: number; errors: string[] } | null>(
    null
  );

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
    const res = await fetch("/api/families/bulk-update/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolYearId, rows }),
    });
    setLoadingPreview(false);

    if (!res.ok) {
      setError("Something went wrong checking these rows. Please try again.");
      return;
    }

    const data = await res.json();
    const newResults: ResolveResult[] = data.results;
    const newGroups: CreateGroup[] = data.createGroups;

    setResults(newResults);
    setCreateGroups(newGroups);
    setCheckedUpdates(
      new Set(newResults.filter((r) => r.status === "update").map((r) => r.rowIndex))
    );
    setCheckedGroups(new Set());
    setGroupNames(Object.fromEntries(newGroups.map((g) => [g.groupKey, g.suggestedName ?? ""])));
  }

  function toggleUpdate(rowIndex: number) {
    setCheckedUpdates((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function toggleGroup(groupKey: string) {
    setCheckedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  async function handleApply() {
    if (!results) return;
    setApplying(true);
    setError(null);

    const addLinks = results
      .filter((r) => r.status === "update" && checkedUpdates.has(r.rowIndex) && r.addLinks)
      .map((r) => ({
        familyId: r.addLinks!.familyId,
        studentId: r.addLinks!.addStudentLink ? r.studentId : undefined,
        parentIds: r.addLinks!.addParentIds,
      }));

    const createFamilies = createGroups
      .filter((g) => checkedGroups.has(g.groupKey))
      .map((g) => ({
        name: groupNames[g.groupKey]?.trim() || null,
        studentIds: g.students.map((s) => s.studentId),
        parentIds: g.parentIds,
      }));

    const res = await fetch("/api/families/bulk-update/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLinks, createFamilies }),
    });
    setApplying(false);

    if (!res.ok) {
      setError("Applying failed. Please try again.");
      return;
    }

    setApplyResult(await res.json());
    setResults(null);
    setCreateGroups([]);
    setRawText("");
  }

  const updateRows = (results ?? []).filter((r) => r.status === "update");
  const noChangeRows = (results ?? []).filter((r) => r.status === "no-change");
  const attentionRows = (results ?? []).filter((r) => r.status === "attention" || r.status === "error");

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">School Year</label>
        <select
          value={schoolYearId}
          onChange={(e) => setSchoolYearId(e.target.value)}
          className="border rounded p-2"
        >
          {schoolYears.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Used to resolve the classroom abbreviation against that year&apos;s homerooms.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Paste rows (from Excel), or load a CSV file below
        </label>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={8}
          placeholder={
            "Child First\tChild Last\tClassroom\tParent 1 First\tParent 1 Last\tParent 1 Email\tParent 2 First\tParent 2 Last\tParent 2 Email\nAlex\tRivera\t2A\tJordan\tRivera\tjordan@example.com\tTaylor\tRivera\ttaylor@example.com"
          }
          className="w-full border rounded p-2 font-mono text-sm"
        />
        <input type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} className="mt-2 text-sm" />
        <p className="text-xs text-gray-500 mt-1">
          A CSV file is read in your browser and never uploaded anywhere -- only the matches you
          approve below ever get saved. Rows can have any number of parent columns.
        </p>
      </div>

      <button
        type="button"
        onClick={handlePreview}
        disabled={loadingPreview || !schoolYearId}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {loadingPreview ? "Checking…" : "Check Against Database"}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {applyResult && (
        <p className="text-sm bg-green-50 border border-green-200 rounded p-2">
          Added links for {applyResult.linksAdded}, created {applyResult.familiesCreated} new famil
          {applyResult.familiesCreated === 1 ? "y" : "ies"}.
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
              <h2 className="font-semibold mb-2">Family link updates ({updateRows.length})</h2>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="p-2"></th>
                    <th className="p-2">Child</th>
                    <th className="p-2">Classroom</th>
                    <th className="p-2">Parents</th>
                    <th className="p-2">Will add</th>
                  </tr>
                </thead>
                <tbody>
                  {updateRows.map((r) => (
                    <tr key={r.rowIndex} className="border-b align-top">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={checkedUpdates.has(r.rowIndex)}
                          onChange={() => toggleUpdate(r.rowIndex)}
                        />
                      </td>
                      <td className="p-2">
                        {r.childFirstName} {r.childLastName}
                      </td>
                      <td className="p-2">{r.classroomAbbr}</td>
                      <td className="p-2">{parentSummary(r.parents)}</td>
                      <td className="p-2 text-xs text-gray-600">
                        {[
                          r.addLinks?.addStudentLink ? "link child to family" : null,
                          r.addLinks && r.addLinks.addParentIds.length > 0
                            ? `add ${r.addLinks.addParentIds.length} parent(s)`
                            : null,
                        ]
                          .filter(Boolean)
                          .join("; ")}
                        {r.issues.length > 0 && (
                          <div className="text-amber-700 mt-1">{r.issues.join("; ")}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {createGroups.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">New families to create ({createGroups.length})</h2>
              <p className="text-xs text-gray-500 mb-2">
                Unchecked by default -- these children and parents don&apos;t have a family on
                file yet. Siblings sharing the same matched parents are grouped into one new
                family rather than several.
              </p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="p-2"></th>
                    <th className="p-2">Family name</th>
                    <th className="p-2">Children</th>
                    <th className="p-2">Parents</th>
                  </tr>
                </thead>
                <tbody>
                  {createGroups.map((g) => (
                    <tr key={g.groupKey} className="border-b align-top">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={checkedGroups.has(g.groupKey)}
                          onChange={() => toggleGroup(g.groupKey)}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={groupNames[g.groupKey] ?? ""}
                          onChange={(e) =>
                            setGroupNames((prev) => ({ ...prev, [g.groupKey]: e.target.value }))
                          }
                          className="border rounded p-1 w-32"
                        />
                      </td>
                      <td className="p-2">{g.students.map((s) => s.name).join(", ")}</td>
                      <td className="p-2">{g.parentNames.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {attentionRows.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Needs attention ({attentionRows.length})</h2>
              <p className="text-xs text-gray-500 mb-2">
                Not applied -- fix the source data (or an existing conflict) and re-check.
              </p>
              <ul className="text-sm space-y-1">
                {attentionRows.map((r) => (
                  <li key={r.rowIndex} className="text-amber-700">
                    {r.childFirstName} {r.childLastName} ({r.classroomAbbr}): {r.issues.join("; ")}
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
                    {r.childFirstName} {r.childLastName}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(updateRows.length > 0 || createGroups.length > 0) && (
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
