"use client";

import { GRADE_ORDER, GRADE_LABEL } from "@/lib/grades";

interface RosterFiltersProps {
  schoolYears: { id: string; label: string }[];
  selectedSchoolYearId?: string;
  selectedGrade?: string;
}

// Plain GET form, same pattern as admin/classrooms/YearFilter: each select
// auto-submits on change, so the filtered view is a shareable URL. This
// intentionally only submits schoolYearId + grade -- changing either drops
// any classroomId filter in the URL, since a classroom from one year/grade
// isn't meaningful once you've navigated away from it (see page.tsx).
export default function RosterFilters({
  schoolYears,
  selectedSchoolYearId,
  selectedGrade,
}: RosterFiltersProps) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-4 mb-4">
      <span>
        <label className="text-sm font-medium mr-2">School Year</label>
        <select
          name="schoolYearId"
          defaultValue={selectedSchoolYearId}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="border rounded p-2"
        >
          {schoolYears.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label}
            </option>
          ))}
        </select>
      </span>

      <span>
        <label className="text-sm font-medium mr-2">Grade</label>
        <select
          name="grade"
          defaultValue={selectedGrade ?? ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="border rounded p-2"
        >
          <option value="">All grades</option>
          {GRADE_ORDER.map((g) => (
            <option key={g} value={g}>
              {GRADE_LABEL[g]}
            </option>
          ))}
        </select>
      </span>
    </form>
  );
}
