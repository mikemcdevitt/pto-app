import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { students } from "@/db/schema";
import { assignStudentClassroom } from "@/lib/assign-classroom";
import { NextResponse } from "next/server";

// Writes exactly what the admin checked off on the bulk-update preview
// (src/app/admin/students/bulk-update) -- nothing here re-derives matches
// or re-parses anything; it trusts the studentId/classroomId values the
// resolve route already worked out and the client already showed them.
// Each item is applied independently and reported on its own, so one
// failure (a stale studentId, a classroom deleted since the preview) doesn't
// block the rest -- same non-atomic tradeoff as the rest of this project's
// bulk-write scripts (neon-http has no transactions).

interface UpdateItem {
  studentId: string;
  classroomId: string | null;
}

interface CreateItem {
  firstName: string;
  lastName: string;
  cohortYear: number;
  classroomId: string | null;
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const schoolYearId: string | undefined = body.schoolYearId;
  const updates: UpdateItem[] = Array.isArray(body.updates) ? body.updates : [];
  const creates: CreateItem[] = Array.isArray(body.creates) ? body.creates : [];

  if (!schoolYearId) {
    return NextResponse.json({ error: "schoolYearId is required" }, { status: 400 });
  }

  let updated = 0;
  let created = 0;
  const errors: string[] = [];

  for (const item of updates) {
    try {
      await assignStudentClassroom(item.studentId, schoolYearId, item.classroomId);
      updated++;
    } catch (err) {
      console.error(err);
      errors.push(`Couldn't update classroom for student ${item.studentId}`);
    }
  }

  for (const item of creates) {
    try {
      const [newStudent] = await db
        .insert(students)
        .values({ firstName: item.firstName, lastName: item.lastName, cohortYear: item.cohortYear })
        .returning();
      if (item.classroomId) {
        await assignStudentClassroom(newStudent.id, schoolYearId, item.classroomId);
      }
      created++;
    } catch (err) {
      console.error(err);
      errors.push(`Couldn't create student "${item.firstName} ${item.lastName}"`);
    }
  }

  return NextResponse.json({ updated, created, errors });
}
