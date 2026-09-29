import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { parents, parentStudents, parentEmails, students } from "@/db/schema";
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
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const primaryEmail = body.email.toLowerCase().trim();
  const additionalEmails = Array.from(
    new Set(
      ((body.additionalEmails ?? []) as string[])
        .map((e) => e.toLowerCase().trim())
        .filter((e) => e !== "" && e !== primaryEmail)
    )
  );

  try {
    const [updated] = await db
      .update(parents)
      .set({
        email: primaryEmail,
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

    // Sync parent_emails the same way: wipe and reinsert, mirroring the
    // primary in alongside any additional ones so parent_emails always has
    // a row for every email that resolves to this parent (see the schema
    // comment on parent_emails). Not atomic with the parents.email update
    // above -- neon-http doesn't support transactions -- so a conflict here
    // (someone else already has one of these emails) can leave parents.email
    // changed with parent_emails not yet caught up; re-saving fixes it.
    await db.delete(parentEmails).where(eq(parentEmails.parentId, id));
    await db.insert(parentEmails).values([
      { parentId: id, email: primaryEmail, isPrimary: true },
      ...additionalEmails.map((email) => ({ parentId: id, email, isPrimary: false })),
    ]);

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json({ error: "One of these emails is already in use by another parent." }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(parents).where(eq(parents.id, id));
  return NextResponse.json({ success: true });
}