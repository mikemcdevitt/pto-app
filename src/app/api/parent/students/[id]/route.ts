import { auth } from "@/auth";
import { db } from "@/db";
import { parents, parentStudents, students } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function getLinkedParentStudent(email: string, studentId: string) {
  const [parent] = await db.select().from(parents).where(eq(parents.email, email));
  if (!parent) return null;

  const [link] = await db
    .select()
    .from(parentStudents)
    .where(and(eq(parentStudents.parentId, parent.id), eq(parentStudents.studentId, studentId)));

  return link ? parent : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const parent = await getLinkedParentStudent(email, id);
  if (!parent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const [updated] = await db
    .update(students)
    .set({ firstName: body.firstName, lastName: body.lastName })
    .where(eq(students.id, id))
    .returning();

  return NextResponse.json(updated);
}