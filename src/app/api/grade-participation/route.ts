// Public, read-only, PII-free. Returns donation-participation % per grade
// for the current school year. This is the ONLY thing the Wix donate page
// ever fetches — never names, emails, or dollar amounts.
//
// GET /api/grade-participation           -> real data
// GET /api/grade-participation?mock=1    -> fake data, for testing the chart
//                                            before real donations exist

import { NextResponse } from "next/server";
import { db } from "@/db";
import { classrooms, donations, familyParents, familyStudents, parentEmails, schoolYears, students } from "@/db/schema";
import { count, eq } from "drizzle-orm";
import { GRADE_ORDER, GRADE_LABEL, gradeForCohortInSchoolYear } from "@/lib/grades";

// This route queries the DB directly (no `fetch`), and only touches
// `request.url` via plain `new URL()` rather than a Next.js dynamic API
// (request.nextUrl, cookies(), headers()) -- so Next doesn't detect it
// needs per-request execution and is happy to statically cache it at build
// time otherwise. Same bug as the admin pages had (see their
// "force-dynamic" comments): without this, the response can go stale and
// never reflect new donations/imports until the next deploy.
export const dynamic = "force-dynamic";

// Kindergarten alone still falls back to this placeholder estimate --
// classrooms-in-that-grade * this constant -- since KG enrollment is
// still catching up in the system (new families who haven't been
// entered yet would make a real KG family count understate the true
// denominator). Every other grade's total is a real, live distinct
// family count -- see familyCountByGrade below.
const PLACEHOLDER_FAMILIES_PER_CLASSROOM = 15;

// Allow the Wix site to fetch this cross-origin. CORS only affects browser
// fetches, not direct curl access — that's fine here since the response
// never contains anything sensitive, only aggregate percentages.
const ALLOWED_ORIGIN = "https://www.spragueschoolpto.com";

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("mock") === "1") {
    const mock = GRADE_ORDER.map((grade, i) => {
      const total = 60 + i * 4;
      const donating = Math.round(total * (0.3 + Math.random() * 0.5));
      return {
        grade,
        label: GRADE_LABEL[grade],
        donating,
        total,
        percent: Math.round((donating / total) * 100),
      };
    });
    return withCors(NextResponse.json({ grades: mock, mock: true }));
  }

  const schoolYearLabel = process.env.CURRENT_SCHOOL_YEAR_LABEL;
  const campaignId = process.env.WIX_DONATION_CAMPAIGN_ID;
  if (!schoolYearLabel || !campaignId) {
    return withCors(
      NextResponse.json(
        { error: "Missing CURRENT_SCHOOL_YEAR_LABEL or WIX_DONATION_CAMPAIGN_ID" },
        { status: 500 }
      )
    );
  }

  const [schoolYear] = await db
    .select()
    .from(schoolYears)
    .where(eq(schoolYears.label, schoolYearLabel));
  if (!schoolYear) {
    return withCors(
      NextResponse.json(
        { error: `No school_years row with label "${schoolYearLabel}"` },
        { status: 500 }
      )
    );
  }

  // Placeholder "total" -- see TODO(families) above. Real classroom counts
  // per grade this school year, stood in for a real family count.
  const classroomCounts = await db
    .select({ grade: classrooms.grade, classroomCount: count() })
    .from(classrooms)
    .where(eq(classrooms.schoolYearId, schoolYear.id))
    .groupBy(classrooms.grade);
  const classroomCountByGrade = new Map(
    classroomCounts.map((r) => [r.grade, Number(r.classroomCount)])
  );

  // "donating": distinct FAMILIES with a student in this grade (by cohort
  // year, not a classroom assignment -- a student counts as soon as they
  // have a cohort year on file, no student_classrooms row required) where
  // ANY of a linked parent's emails -- primary or additional, via
  // parent_emails rather than parents.email -- appears in `donations` for
  // this campaign. parent_emails always has a row for a parent's primary
  // email too (kept in sync by the parent create/edit routes), so this
  // one join covers every address without also joining `parents`.
  // Family-based via family_parents/family_students rather than
  // parent_students: nothing populates parent_students for bulk-imported
  // families (see sync-parent-students.ts, which backfills it for the
  // admin/parent-facing pages that do need it, but this route doesn't
  // depend on that anymore), while family_parents/family_students are
  // exactly what the import pipeline writes and what
  // merge-duplicate-families.ts cleaned up. This also fixes the old
  // double-counting: a family with two donating parents now counts once
  // per grade, not once per parent.
  const familyParentLinks = await db
    .select({ familyId: familyParents.familyId, email: parentEmails.email })
    .from(familyParents)
    .innerJoin(parentEmails, eq(parentEmails.parentId, familyParents.parentId));

  const familyStudentLinks = await db
    .select({ familyId: familyStudents.familyId, cohortYear: students.cohortYear })
    .from(familyStudents)
    .innerJoin(students, eq(students.id, familyStudents.studentId));

  const campaignDonations = await db
    .select({ donorEmail: donations.donorEmail })
    .from(donations)
    .where(eq(donations.wixCampaignId, campaignId));
  const donatingEmails = new Set(campaignDonations.map((d) => d.donorEmail.toLowerCase()));

  const emailsByFamily = new Map<string, string[]>();
  for (const link of familyParentLinks) {
    emailsByFamily.set(link.familyId, [...(emailsByFamily.get(link.familyId) ?? []), link.email.toLowerCase()]);
  }

  // familyCountByGrade: every distinct family with a student in that
  // grade (regardless of whether they've donated) -- the real
  // denominator for grades other than kindergarten, computed from the
  // same family_students/students join as "donating" above rather than
  // a second query.
  const donatingByGrade = new Map<string, Set<string>>();
  const familyCountByGrade = new Map<string, Set<string>>();
  for (const link of familyStudentLinks) {
    if (link.cohortYear == null) continue; // no cohort year on file -- can't place them in a grade
    const grade = gradeForCohortInSchoolYear(link.cohortYear, schoolYear.sortYear);
    if (!grade) continue; // graduated, or not yet in K-5 as of this school year

    if (!familyCountByGrade.has(grade)) familyCountByGrade.set(grade, new Set());
    familyCountByGrade.get(grade)!.add(link.familyId);

    const familyEmails = emailsByFamily.get(link.familyId) ?? [];
    if (!familyEmails.some((e) => donatingEmails.has(e))) continue;
    if (!donatingByGrade.has(grade)) donatingByGrade.set(grade, new Set());
    donatingByGrade.get(grade)!.add(link.familyId);
  }

  const grades = GRADE_ORDER.map((grade) => {
    const classroomCount = classroomCountByGrade.get(grade) ?? 0;
    const total =
      grade === "kindergarten"
        ? classroomCount * PLACEHOLDER_FAMILIES_PER_CLASSROOM
        : familyCountByGrade.get(grade)?.size ?? 0;
    const donating = donatingByGrade.get(grade)?.size ?? 0;
    return {
      grade,
      label: GRADE_LABEL[grade],
      donating,
      total,
      percent: total > 0 ? Math.round((donating / total) * 100) : 0,
    };
  });

  return withCors(NextResponse.json({ grades, mock: false }));
}
