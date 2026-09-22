import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { students } from "@/db/schema";
import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const all = await db.select().from(students).orderBy(asc(students.lastName), asc(students.firstName));
  return NextResponse.json(all);
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const [created] = await db
    .insert(students)
    .values({
      firstName: body.firstName,
      lastName: body.lastName,
      cohortYear: body.cohortYear ?? null,
    })
    .returning();
  return NextResponse.json(created, { status: 201 });
}