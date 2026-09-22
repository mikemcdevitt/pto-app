// Pulls Wix donation orders (for the Annual Appeal campaign) created since the
// last synced order, and upserts them into the `donations` table. Scheduled
// via vercel.json (every 30 min during the campaign).
//
// Trigger manually while testing with:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/sync-wix-donations

import { NextResponse } from "next/server";
import { db } from "@/db";
import { donations, schoolYears } from "@/db/schema";
import { fetchWixDonationOrdersSince } from "@/lib/wix-orders";
import { desc, eq, sql } from "drizzle-orm";

// Fallback start point if there's no prior donation on file yet — the date
// the Annual Appeal actually opened. Adjust this once, then it's unused
// after the first sync (the max(orderCreatedAt) below takes over).
const CAMPAIGN_OPENED_AT = "2026-09-01T00:00:00.000Z";

export async function GET(request: Request) {
  // Vercel Cron sends its own auth; this also allows a manual test trigger.
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaignId = process.env.WIX_DONATION_CAMPAIGN_ID;
  const schoolYearLabel = process.env.CURRENT_SCHOOL_YEAR_LABEL;
  if (!campaignId || !schoolYearLabel) {
    return NextResponse.json(
      { error: "Missing WIX_DONATION_CAMPAIGN_ID or CURRENT_SCHOOL_YEAR_LABEL" },
      { status: 500 }
    );
  }

  const [schoolYear] = await db
    .select()
    .from(schoolYears)
    .where(eq(schoolYears.label, schoolYearLabel));
  if (!schoolYear) {
    return NextResponse.json(
      { error: `No school_years row with label "${schoolYearLabel}"` },
      { status: 500 }
    );
  }

  const [lastOrder] = await db
    .select({ orderCreatedAt: donations.orderCreatedAt })
    .from(donations)
    .orderBy(desc(donations.orderCreatedAt))
    .limit(1);
  const since = lastOrder?.orderCreatedAt.toISOString() ?? CAMPAIGN_OPENED_AT;

  const orders = await fetchWixDonationOrdersSince(since);

  let upserted = 0;
  for (const order of orders) {
    if (!order.donorEmail) continue; // skip orders with no email on file

    await db
      .insert(donations)
      .values({
        wixOrderId: order.id,
        wixOrderNumber: order.number,
        donorEmail: order.donorEmail.toLowerCase().trim(),
        amountCents: order.amountCents,
        wixCampaignId: campaignId,
        schoolYearId: schoolYear.id,
        orderCreatedAt: new Date(order.createdAt),
      })
      .onConflictDoUpdate({
        target: [donations.donorEmail, donations.wixCampaignId],
        set: {
          amountCents: order.amountCents,
          syncedAt: sql`now()`,
        },
      });
    upserted++;
  }

  return NextResponse.json({ ok: true, ordersFetched: orders.length, upserted });
}
