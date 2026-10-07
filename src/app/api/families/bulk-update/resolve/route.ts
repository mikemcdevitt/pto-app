import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import {
  classrooms,
  familyParents,
  familyStudents,
  parentEmails,
  schoolYears,
  students,
  studentClassrooms,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// Read-only: works out what each row would do, without writing anything
// (the apply route, given only what's checked, does the actual writes).
//
// A row is a child plus any number of parents. The child is matched by
// name + classroom abbreviation (resolved against classrooms for the
// selected school year, then against whichever student has a
// student_classrooms row there with that name) -- never by cohort year,
// since this export doesn't carry one. Each parent is matched by email
// against parent_emails, same as the parents bulk-update page. Neither a
// missing student nor a missing parent is ever created here -- this page
// only fixes family_parents/family_students links between records that
// already exist.
//
// For a row whose child and 1+ parents both matched, the target family
// is: the child's existing family, if they have one; otherwise the one
// family shared by every matched parent that already has one (if they
// don't all agree, or some already belong to a family some do agree on,
// flagging and refuse to guess rather than reshuffle anyone); otherwise,
// if none of the matched parents have a family either, a brand-new one.
//
// New-family proposals are grouped by their exact set of matched parent
// ids rather than reported per row, so two sibling rows that'd otherwise
// each propose "create a new family for these same two parents" become
// one proposal covering both children -- never two separate new
// families for what's really one household.

interface RawParentSlot {
  firstName: string;
  lastName: string;
  email: string;
}

interface RawRow {
  rowIndex: number;
  childFirstName: string;
  childLastName: string;
  classroomAbbr: string;
  parents: RawParentSlot[];
}

interface ParentSlotResult {
  position: number;
  firstName: string;
  lastName: string;
  email: string;
  parentId?: string;
  status: "matched" | "not-found" | "conflict";
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const schoolYearId: string | undefined = body.schoolYearId;
  const rows: RawRow[] = Array.isArray(body.rows) ? body.rows : [];

  if (!schoolYearId) {
    return NextResponse.json({ error: "schoolYearId is required" }, { status: 400 });
  }
  const [schoolYear] = await db.select().from(schoolYears).where(eq(schoolYears.id, schoolYearId));
  if (!schoolYear) {
    return NextResponse.json({ error: "No such school year" }, { status: 404 });
  }

  const classroomsForYear = await db
    .select({ id: classrooms.id, abbreviation: classrooms.abbreviation })
    .from(classrooms)
    .where(eq(classrooms.schoolYearId, schoolYearId));
  const classroomByAbbr = new Map(classroomsForYear.map((c) => [c.abbreviation.toLowerCase(), c.id]));

  const allStudents = await db
    .select({ id: students.id, firstName: students.firstName, lastName: students.lastName })
    .from(students);

  const studentClassroomRows = await db
    .select({ studentId: studentClassrooms.studentId, classroomId: studentClassrooms.classroomId })
    .from(studentClassrooms)
    .where(eq(studentClassrooms.schoolYearId, schoolYearId));
  const studentIdsByClassroomId = new Map<string, Set<string>>();
  for (const r of studentClassroomRows) {
    if (!studentIdsByClassroomId.has(r.classroomId)) studentIdsByClassroomId.set(r.classroomId, new Set());
    studentIdsByClassroomId.get(r.classroomId)!.add(r.studentId);
  }

  const allParentEmails = await db.select().from(parentEmails);
  const parentIdByEmail = new Map(allParentEmails.map((pe) => [pe.email.toLowerCase(), pe.parentId]));

  const familyParentRows = await db.select().from(familyParents);
  const familyIdsByParentId = new Map<string, string[]>();
  for (const r of familyParentRows) {
    if (!familyIdsByParentId.has(r.parentId)) familyIdsByParentId.set(r.parentId, []);
    familyIdsByParentId.get(r.parentId)!.push(r.familyId);
  }

  const familyStudentRows = await db.select().from(familyStudents);
  const familyIdByStudentId = new Map(familyStudentRows.map((r) => [r.studentId, r.familyId]));

  const results: Record<string, unknown>[] = [];
  const createGroups = new Map<
    string,
    { groupKey: string; parentIds: string[]; parentNames: string[]; students: { studentId: string; name: string }[]; rowIndexes: number[] }
  >();

  for (const row of rows) {
    const childFirstName = row.childFirstName.trim();
    const childLastName = row.childLastName.trim();
    const classroomAbbr = row.classroomAbbr.trim();
    const parentSlots: ParentSlotResult[] = row.parents
      .filter((p) => p.email.trim() !== "")
      .map((p, i) => {
        const email = p.email.trim().toLowerCase();
        const parentId = parentIdByEmail.get(email);
        return {
          position: i + 1,
          firstName: p.firstName.trim(),
          lastName: p.lastName.trim(),
          email,
          parentId,
          status: parentId ? ("matched" as const) : ("not-found" as const),
        };
      });

    const issues: string[] = [];
    let studentId: string | undefined;
    let studentStatus: "matched" | "not-found" | "ambiguous" = "not-found";

    const classroomId = classroomByAbbr.get(classroomAbbr.toLowerCase());
    if (!classroomId) {
      issues.push(`No classroom with abbreviation "${classroomAbbr}" in ${schoolYear.label}`);
    } else {
      const candidateIds = studentIdsByClassroomId.get(classroomId) ?? new Set<string>();
      const matches = allStudents.filter(
        (s) =>
          candidateIds.has(s.id) &&
          s.firstName.toLowerCase() === childFirstName.toLowerCase() &&
          s.lastName.toLowerCase() === childLastName.toLowerCase()
      );
      if (matches.length === 1) {
        studentId = matches[0].id;
        studentStatus = "matched";
      } else if (matches.length > 1) {
        studentStatus = "ambiguous";
        issues.push(`${matches.length} students named "${childFirstName} ${childLastName}" are in classroom "${classroomAbbr}" -- can't tell which`);
      } else {
        issues.push(`No student named "${childFirstName} ${childLastName}" is assigned to classroom "${classroomAbbr}" in ${schoolYear.label}`);
      }
    }

    if (studentStatus !== "matched" || !studentId) {
      results.push({ rowIndex: row.rowIndex, childFirstName, childLastName, classroomAbbr, studentStatus, parents: parentSlots, status: "error", issues });
      continue;
    }

    const matchedParentIds = parentSlots.filter((p) => p.status === "matched").map((p) => p.parentId!);
    if (matchedParentIds.length === 0) {
      results.push({
        rowIndex: row.rowIndex,
        childFirstName,
        childLastName,
        classroomAbbr,
        studentId,
        studentStatus,
        parents: parentSlots,
        status: "attention",
        issues: [...issues, "None of this row's parent emails matched an existing parent"],
      });
      continue;
    }

    const studentFamilyId = familyIdByStudentId.get(studentId) ?? null;
    let targetFamilyId: string | null = studentFamilyId;

    if (!targetFamilyId) {
      const distinctFamilies = new Set<string>();
      for (const pid of matchedParentIds) {
        for (const f of familyIdsByParentId.get(pid) ?? []) distinctFamilies.add(f);
      }
      if (distinctFamilies.size === 1) {
        targetFamilyId = [...distinctFamilies][0];
      } else if (distinctFamilies.size > 1) {
        results.push({
          rowIndex: row.rowIndex,
          childFirstName,
          childLastName,
          classroomAbbr,
          studentId,
          studentStatus,
          parents: parentSlots,
          status: "attention",
          issues: [...issues, "This row's matched parents already belong to different families -- resolve by hand"],
        });
        continue;
      }
    }

    if (targetFamilyId) {
      const addParentIds: string[] = [];
      const parentConflictIssues: string[] = [];
      for (const slot of parentSlots) {
        if (slot.status !== "matched") continue;
        const fams = familyIdsByParentId.get(slot.parentId!) ?? [];
        if (fams.includes(targetFamilyId)) continue;
        if (fams.length > 0) {
          slot.status = "conflict";
          parentConflictIssues.push(`${slot.firstName} ${slot.lastName} is already in a different family -- not added`);
        } else {
          addParentIds.push(slot.parentId!);
        }
      }
      const addStudentLink = studentFamilyId !== targetFamilyId;

      if (addParentIds.length === 0 && !addStudentLink) {
        results.push({ rowIndex: row.rowIndex, childFirstName, childLastName, classroomAbbr, studentId, studentStatus, parents: parentSlots, status: "no-change", issues: [...issues, ...parentConflictIssues] });
      } else {
        results.push({
          rowIndex: row.rowIndex,
          childFirstName,
          childLastName,
          classroomAbbr,
          studentId,
          studentStatus,
          parents: parentSlots,
          status: "update",
          issues: [...issues, ...parentConflictIssues],
          addLinks: { familyId: targetFamilyId, addStudentLink, addParentIds },
        });
      }
      continue;
    }

    // No existing family anywhere for this child or any matched parent --
    // propose a brand-new one, grouped with any other row that resolves
    // to the exact same set of matched parents.
    const groupKey = [...matchedParentIds].sort().join(",");
    if (!createGroups.has(groupKey)) {
      createGroups.set(groupKey, {
        groupKey,
        parentIds: matchedParentIds,
        parentNames: parentSlots.filter((s) => s.status === "matched").map((s) => `${s.firstName} ${s.lastName}`),
        students: [],
        rowIndexes: [],
      });
    }
    const group = createGroups.get(groupKey)!;
    group.students.push({ studentId, name: `${childFirstName} ${childLastName}` });
    group.rowIndexes.push(row.rowIndex);

    results.push({
      rowIndex: row.rowIndex,
      childFirstName,
      childLastName,
      classroomAbbr,
      studentId,
      studentStatus,
      parents: parentSlots,
      status: "create-family",
      issues,
      createGroupKey: groupKey,
    });
  }

  const createGroupList = [...createGroups.values()].map((g) => ({
    ...g,
    suggestedName: g.students[0]?.name.split(" ").slice(-1)[0] ?? null,
  }));

  return NextResponse.json({ results, createGroups: createGroupList });
}
