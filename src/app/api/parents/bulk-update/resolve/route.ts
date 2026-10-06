import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { parents, parentEmails } from "@/db/schema";
import { NextResponse } from "next/server";

// Read-only, same shape as /api/students/bulk-update/resolve: takes rows
// the client already split out of pasted/loaded text and works out what
// each one would do, without writing anything.
//
// Matching is by email, checked against parent_emails -- every parent's
// primary email is mirrored in there too (see the schema comment on
// parent_emails), so one lookup covers primary and secondary addresses.
// Since parent_emails.email is globally unique, a row's email can match
// at most one parent -- no "ambiguous by email" case to worry about,
// unlike the student bulk-update's name+cohort matching.
//
// A row whose email doesn't match anyone also gets checked by name
// against every parent's current name, in case it's really an existing
// parent who just switched addresses. That's surfaced as
// "possible-email-change" for a human to confirm (via Edit Parent) --
// never applied automatically, since two different people can share a
// name just as easily as one person can change their email.

interface RawRow {
  rowIndex: number;
  firstName: string;
  lastName: string;
  email: string;
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const rows: RawRow[] = Array.isArray(body.rows) ? body.rows : [];

  const allParents = await db.select().from(parents);
  const allParentEmails = await db.select().from(parentEmails);

  const parentById = new Map(allParents.map((p) => [p.id, p]));
  const parentIdByEmail = new Map(allParentEmails.map((pe) => [pe.email.toLowerCase(), pe.parentId]));

  const results = rows.map((row) => {
    const firstName = row.firstName.trim();
    const lastName = row.lastName.trim();
    const email = row.email.trim().toLowerCase();

    if (!firstName || !lastName || !email) {
      return {
        rowIndex: row.rowIndex,
        firstName,
        lastName,
        email,
        status: "error" as const,
        issues: ["Missing first name, last name, or email"],
      };
    }

    const matchedParentId = parentIdByEmail.get(email);
    if (matchedParentId) {
      const parent = parentById.get(matchedParentId)!;
      const needsUpdate = parent.firstName.trim() !== firstName || parent.lastName.trim() !== lastName;
      return {
        rowIndex: row.rowIndex,
        firstName,
        lastName,
        email,
        parentId: parent.id,
        currentFirstName: parent.firstName,
        currentLastName: parent.lastName,
        status: needsUpdate ? ("update" as const) : ("no-change" as const),
        issues: [],
      };
    }

    const nameMatches = allParents.filter(
      (p) =>
        p.firstName.toLowerCase() === firstName.toLowerCase() &&
        p.lastName.toLowerCase() === lastName.toLowerCase()
    );
    if (nameMatches.length > 0) {
      return {
        rowIndex: row.rowIndex,
        firstName,
        lastName,
        email,
        status: "possible-email-change" as const,
        matchedParents: nameMatches.map((p) => ({ id: p.id, email: p.email })),
        issues: [
          nameMatches.length === 1
            ? `Already on file with a different email (${nameMatches[0].email}) -- possibly just an address change`
            : `${nameMatches.length} existing parents share this name with a different email -- review by hand`,
        ],
      };
    }

    return {
      rowIndex: row.rowIndex,
      firstName,
      lastName,
      email,
      status: "new" as const,
      issues: [],
    };
  });

  return NextResponse.json({ results });
}
