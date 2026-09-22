import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { classrooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
if (!session) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

  const { id } = await params;
  const [classroom] = await db
    .select()
    .from(classrooms)
    .where(eq(classrooms.id, id));
  if (!classroom) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(classroom);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  try {
    const [updated] = await db
      .update(classrooms)
      .set({
        grade: body.grade,
        teacherName: body.teacherName,
        abbreviation: body.abbreviation,
        schoolYearId: body.schoolYearId,
      })
      .where(eq(classrooms.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await db.delete(classrooms).where(eq(classrooms.id, id));
  return NextResponse.json({ success: true });
}