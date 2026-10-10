import { requireFundraising } from "@/lib/require-admin";
import { db } from "@/db";
import { fundraisingContacts, fundraisingPartnerContacts, fundraisingPartners } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cleanText, isUniqueViolation, parseContactBody } from "@/lib/fundraising";

// Link a contact to this partner. Body is either
//   { contactId, role?, isPrimary? }               -- an existing person
//   { newContact: { name, email?, phone? }, role?, isPrimary? } -- create, then link
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: partnerId } = await params;
  const body = await request.json();

  const [partner] = await db
    .select({ id: fundraisingPartners.id })
    .from(fundraisingPartners)
    .where(eq(fundraisingPartners.id, partnerId));
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 });

  let contactId: string | null = cleanText(body.contactId);

  if (!contactId) {
    const parsed = parseContactBody(body.newContact ?? {});
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    if (parsed.values.email) {
      const [existing] = await db
        .select({ name: fundraisingContacts.name })
        .from(fundraisingContacts)
        .where(eq(fundraisingContacts.email, parsed.values.email));
      if (existing) {
        return NextResponse.json(
          { error: `${existing.name} already has that email -- pick them from "Existing contact" instead.` },
          { status: 409 }
        );
      }
    }

    try {
      const [created] = await db.insert(fundraisingContacts).values(parsed.values).returning();
      contactId = created.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return NextResponse.json({ error: "Another contact already has that email." }, { status: 409 });
      }
      throw err;
    }
  }

  const isPrimary = body.isPrimary === true;
  const link = { partnerId, contactId, role: cleanText(body.role), isPrimary, isCurrent: true };

  try {
    if (isPrimary) {
      // Clear the old primary and add the new link in one transaction, so
      // the one-primary-per-partner index never sees two at once.
      await db.batch([
        db
          .update(fundraisingPartnerContacts)
          .set({ isPrimary: false })
          .where(and(eq(fundraisingPartnerContacts.partnerId, partnerId), eq(fundraisingPartnerContacts.isPrimary, true))),
        db.insert(fundraisingPartnerContacts).values(link),
      ]);
    } else {
      await db.insert(fundraisingPartnerContacts).values(link);
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "That person is already a contact for this partner." }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json(link, { status: 201 });
}
