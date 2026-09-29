// Public, read-only, PII-free. Returns donation-participation % per grade
// for the current school year. This is the ONLY thing the Wix donate page
// ever fetches — never names, emails, or dollar amounts.
//
// GET /api/grade-participation           -> real data
// GET /api/grade-participation?mock=1    -> fake data, for testing the chart
//                                            before real donations exist

import { NextResponse } from "next/server";
import { db } from "@/db";
import { classrooms, donations, parents, parentStudents, schoolYears, students } from "@/db/schema";
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

// TODO(families): the `families` table exists in the schema (src/db/schema.ts)
// but nothing populates or links it yet -- no backfill grouping existing
// parents/students into households, no admin UI to manage them. Until that's
// done, "how many families are in this grade" can't be a real count, so we
// estimate it as classrooms-in-that-grade * this constant. Get an updated,
// real per-grade family count (or better, switch this to
// count(distinct family) once families are populated) and replace this.
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

  // "donating": distinct parents whose grade is determined by their
  // student's cohort year (not a classroom assignment), and whose email
  // also appears in `donations` for this campaign. Cohort-year-based
  // rather than classroom-based so a student counts as soon as they have a
  // cohort year on file -- they don't also need a student_classrooms row
  // for the current year, which a freshly-imported student won't have yet.
  // Still parent-based, not family-based -- a family with two donating
  // parents is currently double-counted here. Revisit alongside the
  // TODO(families) above once there's a real per-grade family count.
  const links = await db
    .select({
      parentId: parentStudents.parentId,
      email: parents.email,
      cohortYear: students.cohortYear,
    })
    .from(parentStudents)
    .innerJoin(parents, eq(parents.id, parentStudents.parentId))
    .innerJoin(students, eq(students.id, parentStudents.studentId));

  const campaignDonations = await db
    .select({ donorEmail: donations.donorEmail })
    .from(donations)
    .where(eq(donations.wixCampaignId, campaignId));
  const donatingEmails = new Set(campaignDonations.map((d) => d.donorEmail.toLowerCase()));

  const donatingByGrade = new Map<string, Set<string>>();
  for (const link of links) {
    if (link.cohortYear == null) continue; // no cohort year on file -- can't place them in a grade
    const grade = gradeForCohortInSchoolYear(link.cohortYear, schoolYear.sortYear);
    if (!grade) continue; // graduated, or not yet in K-5 as of this school year
    if (!donatingEmails.has(link.email.toLowerCase())) continue;
    if (!donatingByGrade.has(grade)) donatingByGrade.set(grade, new Set());
    donatingByGrade.get(grade)!.add(link.parentId);
  }

  const grades = GRADE_ORDER.map((grade) => {
    const classroomCount = classroomCountByGrade.get(grade) ?? 0;
    const total = classroomCount * PLACEHOLDER_FAMILIES_PER_CLASSROOM;
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
