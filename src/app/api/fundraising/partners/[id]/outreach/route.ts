import { requireFundraising } from "@/lib/require-admin";
import { db } from "@/db";
import { fundraisingOutreach, fundraisingPartners } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cleanDate, cleanText, todayLocal } from "@/lib/fundraising";

// Log outreach to a partner. Body: { note, date?, ptoMember?, contactId?,
// followUpBy? }. Side effects on the partner, both optional conveniences:
//  - followUpBy, if sent, replaces the partner's follow-up date (send ""
//    to clear it; omit the key to leave it alone)
//  - a "prospective" partner becomes "contacted" -- logging outreach means
//    contact has been made
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: partnerId } = await params;
  const body = await request.json();

  const note = cleanText(body.note);
  if (!note) return NextResponse.json({ error: "Write a note about the outreach." }, { status: 400 });
  const date = cleanDate(body.date) ?? (body.date ? undefined : todayLocal());
  if (date === undefined) return NextResponse.json({ error: "Date isn't a valid date." }, { status: 400 });

  let followUpBy: string | null | undefined;
  if ("followUpBy" in body) {
    followUpBy = cleanDate(body.followUpBy);
    if (followUpBy === undefined) {
      return NextResponse.json({ error: "Follow-up date isn't a valid date." }, { status: 400 });
    }
  }

  const [partner] = await db.select().from(fundraisingPartners).where(eq(fundraisingPartners.id, partnerId));
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 });

  const [created] = await db
    .insert(fundraisingOutreach)
    .values({
      partnerId,
      contactId: cleanText(body.contactId),
      date,
      ptoMember: cleanText(body.ptoMember),
      note,
    })
    .returning();

  if (followUpBy !== undefined) {
    await db.update(fundraisingPartners).set({ followUpBy }).where(eq(fundraisingPartners.id, partnerId));
  }
  await db
    .update(fundraisingPartners)
    .set({ status: "contacted" })
    .where(and(eq(fundraisingPartners.id, partnerId), eq(fundraisingPartners.status, "prospective")));

  return NextResponse.json(created, { status: 201 });
}
