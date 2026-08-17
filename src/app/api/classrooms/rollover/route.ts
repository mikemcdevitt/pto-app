import { auth } from "@/auth";
import { db } from "@/db";
import { classrooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fromYearId, toYearId } = await request.json();

  if (!fromYearId || !toYearId) {
    return NextResponse.json(
      { error: "fromYearId and toYearId are required" },
      { status: 400 }
    );
  }
  if (fromYearId === toYearId) {
    return NextResponse.json(
      { error: "From and To year must be different" },
      { status: 400 }
    );
  }

  const sourceClassrooms = await db
    .select()
    .from(classrooms)
    .where(eq(classrooms.schoolYearId, fromYearId));

  if (sourceClassrooms.length === 0) {
    return NextResponse.json(
      { error: "No classrooms found for the selected source year" },
      { status: 400 }
    );
  }

  try {
    const created = await db
      .insert(classrooms)
      .values(
        sourceClassrooms.map((c) => ({
          schoolYearId: toYearId,
          grade: c.grade,
          teacherName: c.teacherName,
          abbreviation: c.abbreviation,
        }))
      )
      .onConflictDoNothing({
        target: [classrooms.schoolYearId, classrooms.abbreviation],
      })
      .returning();

    return NextResponse.json({
      copied: created.length,
      skipped: sourceClassrooms.length - created.length,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong during rollover." },
      { status: 500 }
    );
  }
}