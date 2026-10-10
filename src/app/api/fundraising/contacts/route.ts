import { requireFundraising } from "@/lib/require-admin";
import { db } from "@/db";
import { fundraisingContacts } from "@/db/schema";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUniqueViolation, parseContactBody } from "@/lib/fundraising";

export async function GET() {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const all = await db.select().from(fundraisingContacts).orderBy(sql`lower(${fundraisingContacts.name})`);
  return NextResponse.json(all);
}

export async function POST(request: Request) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = parseContactBody(await request.json());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const [created] = await db.insert(fundraisingContacts).values(parsed.values).returning();
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Another contact already has that email." }, { status: 409 });
    }
    throw err;
  }
}
