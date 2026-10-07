import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { families, familyParents, familyStudents } from "@/db/schema";
import { NextResponse } from "next/server";

// Writes exactly what the admin checked off on the families bulk-update
// preview (src/app/admin/families/bulk-update) -- doesn't re-match
// anything, just trusts the familyId/studentId/parentId values the
// resolve route already worked out. This route only links existing
// students and parents into families (creating a new family row when
// needed) -- it never creates a student or a parent.
//
// Each item applies independently and is reported on its own, same
// non-atomic tradeoff as the rest of this project's bulk-write code
// (neon-http has no transactions).

interface AddLinksItem {
  familyId: string;
  studentId?: string;
  parentIds: string[];
}

interface CreateFamilyItem {
  name: string | null;
  studentIds: string[];
  parentIds: string[];
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const addLinks: AddLinksItem[] = Array.isArray(body.addLinks) ? body.addLinks : [];
  const createFamilies: CreateFamilyItem[] = Array.isArray(body.createFamilies) ? body.createFamilies : [];

  let linksAdded = 0;
  let familiesCreated = 0;
  const errors: string[] = [];

  for (const item of addLinks) {
    try {
      if (item.studentId) {
        await db
          .insert(familyStudents)
          .values({ familyId: item.familyId, studentId: item.studentId })
          .onConflictDoNothing();
      }
      for (const parentId of item.parentIds) {
        await db
          .insert(familyParents)
          .values({ familyId: item.familyId, parentId })
          .onConflictDoNothing();
      }
      linksAdded++;
    } catch (err) {
      console.error(err);
      errors.push(`Couldn't add links for family ${item.familyId}`);
    }
  }

  for (const item of createFamilies) {
    try {
      const [newFamily] = await db
        .insert(families)
        .values({ name: item.name })
        .returning();
      for (const studentId of item.studentIds) {
        await db.insert(familyStudents).values({ familyId: newFamily.id, studentId }).onConflictDoNothing();
      }
      for (const parentId of item.parentIds) {
        await db.insert(familyParents).values({ familyId: newFamily.id, parentId }).onConflictDoNothing();
      }
      familiesCreated++;
    } catch (err) {
      console.error(err);
      errors.push(`Couldn't create new family "${item.name ?? "(unnamed)"}"`);
    }
  }

  return NextResponse.json({ linksAdded, familiesCreated, errors });
}
