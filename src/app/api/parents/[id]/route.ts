import { auth } from "@/auth";
import { db } from "@/db";
import { parents, parentStudents, students } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [parent] = await db.select().from(parents).where(eq(parents.id, id));
  if (!parent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const linkedStudents = await db
    .select({ id: students.id })
    .from(parentStudents)
    .innerJoin(students, eq(parentStudents.studentId, students.id))
    .where(eq(parentStudents.parentId, id));

  return NextResponse.json({ ...parent, studentIds: linkedStudents.map((s) => s.id) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  try {
    const [updated] = await db
      .update(parents)
      .set({
        email: body.email.toLowerCase().trim(),
        firstName: body.firstName,
        lastName: body.lastName,
      })
      .where(eq(parents.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Sync student links: wipe and reinsert (simplest correct approach for a small list)
    const studentIds: string[] = body.studentIds ?? [];
    await db.delete(parentStudents).where(eq(parentStudents.parentId, id));
    if (studentIds.length > 0) {
      await db.insert(parentStudents).values(
        studentIds.map((studentId) => ({ parentId: id, studentId }))
      );
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(parents).where(eq(parents.id, id));
  return NextResponse.json({ success: true });
}