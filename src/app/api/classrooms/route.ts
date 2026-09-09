import { auth } from "@/auth";
import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { classrooms } from "@/db/schema";
import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await requireAdmin();
if (!session) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

  const all = await db
    .select()
    .from(classrooms)
    .orderBy(asc(classrooms.grade), asc(classrooms.abbreviation));
  return NextResponse.json(all);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  try {
    const [created] = await db
      .insert(classrooms)
      .values({
        grade: body.grade,
        teacherName: body.teacherName,
        abbreviation: body.abbreviation,
        schoolYearId: body.schoolYearId,
      })
      .returning();
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json(
        { error: "That abbreviation is already in use." },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}