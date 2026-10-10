import { requireFundraising } from "@/lib/require-admin";
import { db } from "@/db";
import { fundraisingPartnerContacts } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cleanText } from "@/lib/fundraising";

type Params = { params: Promise<{ id: string; contactId: string }> };

// Update this person's role / primary / current flags at this partner.
// Any omitted field is left alone. Marking someone former (isCurrent:
// false) also drops primary -- a former contact can't be the one to call.
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: partnerId, contactId } = await params;
  const body = await request.json();

  const set: { role?: string | null; isPrimary?: boolean; isCurrent?: boolean } = {};
  if ("role" in body) set.role = cleanText(body.role);
  if (typeof body.isCurrent === "boolean") set.isCurrent = body.isCurrent;
  if (typeof body.isPrimary === "boolean") set.isPrimary = body.isPrimary;
  if (set.isCurrent === false) set.isPrimary = false;
  if (set.isPrimary === true) set.isCurrent = true;

  const thisLink = and(
    eq(fundraisingPartnerContacts.partnerId, partnerId),
    eq(fundraisingPartnerContacts.contactId, contactId)
  );

  if (set.isPrimary === true) {
    const [, rows] = await db.batch([
      db
        .update(fundraisingPartnerContacts)
        .set({ isPrimary: false })
        .where(and(eq(fundraisingPartnerContacts.partnerId, partnerId), ne(fundraisingPartnerContacts.contactId, contactId))),
      db.update(fundraisingPartnerContacts).set(set).where(thisLink).returning(),
    ]);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  }

  if (Object.keys(set).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const [updated] = await db.update(fundraisingPartnerContacts).set(set).where(thisLink).returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

// Unlink only -- the person stays in the contacts list.
export async function DELETE(request: Request, { params }: Params) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: partnerId, contactId } = await params;
  await db
    .delete(fundraisingPartnerContacts)
    .where(and(eq(fundraisingPartnerContacts.partnerId, partnerId), eq(fundraisingPartnerContacts.contactId, contactId)));
  return NextResponse.json({ success: true });
}
