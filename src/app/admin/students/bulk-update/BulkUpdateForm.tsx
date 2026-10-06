"use client";

import { useState } from "react";
import { GRADE_LABEL, gradeForCohortInSchoolYear, type Grade } from "@/lib/grades";

interface SchoolYearOption {
  id: string;
  label: string;
  sortYear: number;
}

interface ClassroomOption {
  id: string;
  abbreviation: string;
  grade: Grade;
}

interface ResolveResult {
  rowIndex: number;
  firstName: string;
  lastName: string;
  grade?: Grade;
  cohortYear?: number;
  homeroomRaw?: string;
  resolvedClassroomId?: string | null;
  studentId?: string;
  currentClassroomId?: string | null;
  status: "update" | "no-change" | "ambiguous" | "new" | "error";
  matchedStudentIds?: string[];
  issues: string[];
}

interface RawRow {
  rowIndex: number;
  firstName: string;
  lastName: string;
  gradeRaw: string;
  homeroomRaw: string;
}

interface Override {
  firstName: string;
  lastName: string;
  cohortYear: number;
  classroomId: string | null;
}

interface BulkUpdateFormProps {
  schoolYears: SchoolYearOption[];
}

// Splits pasted/loaded text into rows without a real CSV parser -- good
// enough for First Name, Last Name, Grade, Homeroom with no embedded
// delimiters in the values, which covers a roster export. Detects tab vs.
// comma per line (Excel paste is tab-separated; a .csv file is
// comma-separated) and skips a "First Name, Last Name, ..." header row if
// one is present.
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

  return dataLines.map((line, i) => {
    const cells = splitLine(line);
    return {
      rowIndex: i,
      firstName: cells[0] ?? "",
      lastName: cells[1] ?? "",
      gradeRaw: cells[2] ?? "",
      homeroomRaw: cells[3] ?? "",
    };
  });
}

export default function BulkUpdateForm({ schoolYears }: BulkUpdateFormProps) {
  const [schoolYearId, setSchoolYearId] = useState(schoolYears[0]?.id ?? "");
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [results, setResults] = useState<ResolveResult[] | null>(null);
  const [classroomsForYear, setClassroomsForYear] = useState<ClassroomOption[]>([]);
  const [checkedUpdates, setCheckedUpdates] = useState<Set<number>>(new Set());
  const [checkedCreates, setCheckedCreates] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ updated: number; created: number; errors: string[] } | null>(null);

  const selectedYear = schoolYears.find((y) => y.id === schoolYearId);

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
    const res = await fetch("/api/students/bulk-update/resolve", {
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
    setResults(data.results);
    setClassroomsForYear(data.classroomsForYear);
    setCheckedUpdates(
      new Set(data.results.filter((r: ResolveResult) => r.status === "update").map((r: ResolveResult) => r.rowIndex))
    );
    setCheckedCreates(new Set());
    setOverrides(
      Object.fromEntries(
        data.results
          .filter((r: ResolveResult) => r.status === "new")
          .map((r: ResolveResult) => [
            r.rowIndex,
            {
              firstName: r.firstName,
              lastName: r.lastName,
              cohortYear: r.cohortYear,
              classroomId: r.resolvedClassroomId ?? null,
            },
          ])
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
      .map((r) => ({ studentId: r.studentId!, classroomId: r.resolvedClassroomId ?? null }));

    const creates = results
      .filter((r) => r.status === "new" && checkedCreates.has(r.rowIndex))
      .map((r) => overrides[r.rowIndex])
      .filter((o): o is Override => Boolean(o));

    const res = await fetch("/api/students/bulk-update/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolYearId, updates, creates }),
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

  const classroomById = new Map(classroomsForYear.map((c) => [c.id, c]));
  const updateRows = (results ?? []).filter((r) => r.status === "update");
  const noChangeRows = (results ?? []).filter((r) => r.status === "no-change");
  const attentionRows = (results ?? []).filter((r) => r.status === "ambiguous" || r.status === "error");
  const newRows = (results ?? []).filter((r) => r.status === "new");

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
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Paste rows (from Excel), or load a CSV file below
        </label>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={8}
          placeholder={"First Name\tLast Name\tGrade\tHomeroom\nAlex\tRivera\tGrade 2\t2A"}
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
        disabled={loadingPreview || !schoolYearId}
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
              <h2 className="font-semibold mb-2">Classroom updates ({updateRows.length})</h2>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="p-2"></th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Grade</th>
                    <th className="p-2">Current</th>
                    <th className="p-2">New</th>
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
                      <td className="p-2">
                        {r.firstName} {r.lastName}
                      </td>
                      <td className="p-2">{r.grade ? GRADE_LABEL[r.grade] : ""}</td>
                      <td className="p-2">{classroomById.get(r.currentClassroomId ?? "")?.abbreviation ?? "Unassigned"}</td>
                      <td className="p-2">{r.homeroomRaw || "Unassigned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {newRows.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">No matching student on file ({newRows.length})</h2>
              <p className="text-xs text-gray-500 mb-2">
                Unchecked by default -- review and edit before creating any of these.
              </p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="p-2"></th>
                    <th className="p-2">First Name</th>
                    <th className="p-2">Last Name</th>
                    <th className="p-2">Cohort</th>
                    <th className="p-2">Classroom</th>
                  </tr>
                </thead>
                <tbody>
                  {newRows.map((r) => {
                    const o = overrides[r.rowIndex];
                    if (!o) return null;
                    const expectedGrade = selectedYear
                      ? gradeForCohortInSchoolYear(o.cohortYear, selectedYear.sortYear)
                      : null;
                    const eligible = expectedGrade
                      ? classroomsForYear.filter((c) => c.grade === expectedGrade)
                      : [];
                    return (
                      <tr key={r.rowIndex} className="border-b align-top">
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
                            type="number"
                            value={o.cohortYear}
                            onChange={(e) => updateOverride(r.rowIndex, { cohortYear: Number(e.target.value) })}
                            className="border rounded p-1 w-20"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={eligible.some((c) => c.id === o.classroomId) ? o.classroomId ?? "" : ""}
                            onChange={(e) => updateOverride(r.rowIndex, { classroomId: e.target.value || null })}
                            className="border rounded p-1"
                          >
                            <option value="">— Unassigned —</option>
                            {eligible.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.abbreviation}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {attentionRows.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Needs attention ({attentionRows.length})</h2>
              <p className="text-xs text-gray-500 mb-2">
                Not applied -- fix the source data (or an existing duplicate) and re-check.
              </p>
              <ul className="text-sm space-y-1">
                {attentionRows.map((r) => (
                  <li key={r.rowIndex} className="text-amber-700">
                    {r.firstName} {r.lastName}: {r.issues.join("; ")}
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
                    {r.firstName} {r.lastName}
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
