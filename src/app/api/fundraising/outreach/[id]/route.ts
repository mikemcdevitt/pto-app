import { requireFundraising } from "@/lib/require-admin";
import { db } from "@/db";
import { fundraisingOutreach } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireFundraising();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(fundraisingOutreach).where(eq(fundraisingOutreach.id, id));
  return NextResponse.json({ success: true });
}
