import { requireFundraising } from "@/lib/require-admin";
import { db } from "@/db";
import { fundraisingContacts, fundraisingPartnerContacts, fundraisingPartners } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUniqueViolation, parseContactBody } from "@/lib/fundraising";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [contact] = await db.select().from(fundraisingContacts).where(eq(fundraisingContacts.id, id));
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const partners = await db
    .select({
      id: fundraisingPartners.id,
      name: fundraisingPartners.name,
      role: fundraisingPartnerContacts.role,
      isPrimary: fundraisingPartnerContacts.isPrimary,
      isCurrent: fundraisingPartnerContacts.isCurrent,
    })
    .from(fundraisingPartnerContacts)
    .innerJoin(fundraisingPartners, eq(fundraisingPartnerContacts.partnerId, fundraisingPartners.id))
    .where(eq(fundraisingPartnerContacts.contactId, id));

  return NextResponse.json({ ...contact, partners });
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = parseContactBody(await request.json());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const [updated] = await db
      .update(fundraisingContacts)
      .set(parsed.values)
      .where(eq(fundraisingContacts.id, id))
      .returning();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Another contact already has that email." }, { status: 409 });
    }
    throw err;
  }
}

// Removes the person everywhere: their partner links go with them, and
// outreach entries that named them keep the note but lose the link.
export async function DELETE(request: Request, { params }: Params) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(fundraisingContacts).where(eq(fundraisingContacts.id, id));
  return NextResponse.json({ success: true });
}
