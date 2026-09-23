import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { parents, parentStudents } from "@/db/schema";
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
  try {
    const [created] = await db
      .insert(parents)
      .values({
        email: body.email.toLowerCase().trim(),
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

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
