import { requireFundraising } from "@/lib/require-admin";
import { db } from "@/db";
import { fundraisingPartners } from "@/db/schema";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { parsePartnerBody } from "@/lib/fundraising";

export async function GET() {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const all = await db.select().from(fundraisingPartners).orderBy(sql`lower(${fundraisingPartners.name})`);
  return NextResponse.json(all);
}

export async function POST(request: Request) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = parsePartnerBody(await request.json());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const [created] = await db.insert(fundraisingPartners).values(parsed.values).returning();
  return NextResponse.json(created, { status: 201 });
}
