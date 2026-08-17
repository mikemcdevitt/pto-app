"use client";

interface YearFilterProps {
  years: { id: string; label: string }[];
  activeYearId?: string;
}

export default function YearFilter({ years, activeYearId }: YearFilterProps) {
  return (
    <form method="get" className="mb-4">
      <label className="text-sm font-medium mr-2">School Year</label>
      <select
        name="year"
        defaultValue={activeYearId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="border rounded p-2"
      >
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {y.label}
          </option>
        ))}
      </select>
    </form>
  );
}