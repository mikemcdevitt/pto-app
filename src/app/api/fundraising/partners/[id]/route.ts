import { requireFundraising } from "@/lib/require-admin";
import { db } from "@/db";
import {
  fundraisingContacts,
  fundraisingOutreach,
  fundraisingPartnerContacts,
  fundraisingPartners,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { parsePartnerBody } from "@/lib/fundraising";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [partner] = await db.select().from(fundraisingPartners).where(eq(fundraisingPartners.id, id));
  if (!partner) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const contacts = await db
    .select({
      id: fundraisingContacts.id,
      name: fundraisingContacts.name,
      email: fundraisingContacts.email,
      phone: fundraisingContacts.phone,
      role: fundraisingPartnerContacts.role,
      isPrimary: fundraisingPartnerContacts.isPrimary,
      isCurrent: fundraisingPartnerContacts.isCurrent,
    })
    .from(fundraisingPartnerContacts)
    .innerJoin(fundraisingContacts, eq(fundraisingPartnerContacts.contactId, fundraisingContacts.id))
    .where(eq(fundraisingPartnerContacts.partnerId, id));

  const outreach = await db
    .select()
    .from(fundraisingOutreach)
    .where(eq(fundraisingOutreach.partnerId, id))
    .orderBy(desc(fundraisingOutreach.date), desc(fundraisingOutreach.createdAt));

  return NextResponse.json({ ...partner, contacts, outreach });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = parsePartnerBody(await request.json());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const [updated] = await db
    .update(fundraisingPartners)
    .set(parsed.values)
    .where(eq(fundraisingPartners.id, id))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

// Deletes the partner, its contact links and its outreach log. The people
// themselves stay in fundraising_contacts (they may be linked elsewhere).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(fundraisingPartners).where(eq(fundraisingPartners.id, id));
  return NextResponse.json({ success: true });
}
