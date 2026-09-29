import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { parents, parentStudents, parentEmails } from "@/db/schema";
import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const all = await db.select().from(parents).orderBy(asc(parents.lastName), asc(parents.firstName));
  return NextResponse.json(all);
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const [created] = await db
      .insert(parents)
      .values({
        email: primaryEmail,
        firstName: body.firstName,
        lastName: body.lastName,
      })
      .returning();

    const studentIds: string[] = body.studentIds ?? [];
    if (studentIds.length > 0) {
      await db.insert(parentStudents).values(
        studentIds.map((studentId) => ({ parentId: created.id, studentId }))
      );
    }

    // Mirror the primary email (and any additional ones) into parent_emails
    // right away, so every parent has a matching row there from creation --
    // see the schema comment on parent_emails for why that invariant matters.
    await db.insert(parentEmails).values([
      { parentId: created.id, email: primaryEmail, isPrimary: true },
      ...additionalEmails.map((email) => ({ parentId: created.id, email, isPrimary: false })),
    ]);

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
