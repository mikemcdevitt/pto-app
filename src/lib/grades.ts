// Canonical K-5 grade ordering, display labels, and the cohort-year math,
// shared by anything that maps gradeEnum values to something human-facing
// or needs to work out which grade a student is in for a given school year.

export const GRADE_ORDER = [
  "kindergarten",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
] as const;

export type Grade = (typeof GRADE_ORDER)[number];

export const GRADE_LABEL: Record<Grade, string> = {
  kindergarten: "K",
  first: "Gr 1",
  second: "Gr 2",
  third: "Gr 3",
  fourth: "Gr 4",
  fifth: "Gr 5",
};

// A student's cohort year (students.cohortYear) is the calendar year of
// the summer they're expected to finish 5th grade. A school year's
// sortYear is the calendar year its spring falls in -- label "2026-2027"
// -> sortYear 2027 (see schema.ts / seed.ts). So in a school year ending
// in `schoolYearSortYear`, a student whose cohort year is exactly that
// year is finishing 5th grade; one whose cohort year is a year later is
// in 4th grade that year; and so on, back through kindergarten six grade
// levels (K..5) before their cohort year.
//
// Returns null when the school year falls outside the K-5 span implied by
// the cohort year -- e.g. the student has already finished 5th grade, or
// won't start kindergarten there for several more years.
export function gradeForCohortInSchoolYear(
  cohortYear: number,
  schoolYearSortYear: number
): Grade | null {
  const index = schoolYearSortYear - cohortYear + 5;
  if (index < 0 || index >= GRADE_ORDER.length) return null;
  return GRADE_ORDER[index];
}
