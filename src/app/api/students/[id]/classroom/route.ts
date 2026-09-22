import { auth } from "@/auth";
import { assignStudentClassroom } from "@/lib/assign-classroom";
import { NextResponse } from "next/server";

// Dedicated endpoint for the inline classroom picklist on the Students
// roster list (src/app/admin/students/RosterTable.tsx). Kept separate
// from the general student PATCH so a row edit here never has to know
// or resend the student's name/cohort year.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  if (!body.schoolYearId) {
    return NextResponse.json({ error: "schoolYearId is required" }, { status: 400 });
  }

  try {
    await assignStudentClassroom(id, body.schoolYearId, body.classroomId ?? null);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
