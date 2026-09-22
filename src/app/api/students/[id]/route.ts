import { auth } from "@/auth";
import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { students } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assignStudentClassroom } from "@/lib/assign-classroom";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [student] = await db.select().from(students).where(eq(students.id, id));
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(student);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const [updated] = await db
    .update(students)
    .set({
      firstName: body.firstName,
      lastName: body.lastName,
      cohortYear: body.cohortYear ?? null,
    })
    .where(eq(students.id, id))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Optional classroom assignment for a given school year, from the admin
  // Edit Student form's cohort-based classroom picklist. A classroomId
  // upserts the assignment; a schoolYearId with no classroomId clears
  // whatever assignment exists for that year (the admin picked
  // "Unassigned").
  if (body.schoolYearId) {
    await assignStudentClassroom(id, body.schoolYearId, body.classroomId ?? null);
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(students).where(eq(students.id, id));
  return NextResponse.json({ success: true });
}