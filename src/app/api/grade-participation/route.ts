// Public, read-only, PII-free. Returns donation-participation % per grade
// for the current school year. This is the ONLY thing the Wix donate page
// ever fetches — never names, emails, or dollar amounts.
//
// GET /api/grade-participation           -> real data
// GET /api/grade-participation?mock=1    -> fake data, for testing the chart
//                                            before real donations exist

import { NextResponse } from "next/server";
import { db } from "@/db";
import { schoolYears } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { GRADE_ORDER, GRADE_LABEL } from "@/lib/grades";

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

  // Raw SQL for the aggregation: per grade, distinct families with a student
  // in that grade this school year ("total"), and how many of those families'
  // emails also appear in `donations` for this campaign ("donating").
  const result = await db.execute(sql`
    with family_grade as (
      select distinct
        ps.parent_id,
        p.email,
        c.grade
      from parent_students ps
      join parents p on p.id = ps.parent_id
      join student_classrooms sc on sc.student_id = ps.student_id
      join classrooms c on c.id = sc.classroom_id
      where sc.school_year_id = ${schoolYear.id}
    )
    select
      fg.grade,
      count(distinct fg.parent_id) as total,
      count(distinct case when d.donor_email is not null then fg.parent_id end) as donating
    from family_grade fg
    left join donations d
      on lower(d.donor_email) = lower(fg.email)
      and d.wix_campaign_id = ${campaignId}
    group by fg.grade
  `);

  const byGrade = new Map(
    (result.rows as unknown as { grade: string; total: string; donating: string }[]).map(
      (r) => [r.grade, r]
    )
  );

  const grades = GRADE_ORDER.map((grade) => {
    const r = byGrade.get(grade);
    const total = r ? Number(r.total) : 0;
    const donating = r ? Number(r.donating) : 0;
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
