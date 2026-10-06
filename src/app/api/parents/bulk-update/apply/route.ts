import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/db";
import { parents, parentEmails } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// Writes exactly what the admin checked off on the bulk-update preview
// (src/app/admin/parents/bulk-update) -- doesn't re-match anything, just
// trusts the parentId values the resolve route already worked out.
// Each item applies independently and is reported on its own, same
// non-atomic tradeoff as the rest of this project's bulk-write code
// (neon-http has no transactions).

interface UpdateItem {
  parentId: string;
  firstName: string;
  lastName: string;
}

interface CreateItem {
  firstName: string;
  lastName: string;
  email: string;
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const updates: UpdateItem[] = Array.isArray(body.updates) ? body.updates : [];
  const creates: CreateItem[] = Array.isArray(body.creates) ? body.creates : [];

  let updated = 0;
  let created = 0;
  const errors: string[] = [];

  for (const item of updates) {
    try {
      await db
        .update(parents)
        .set({ firstName: item.firstName, lastName: item.lastName })
        .where(eq(parents.id, item.parentId));
      updated++;
    } catch (err) {
      console.error(err);
      errors.push(`Couldn't update parent ${item.parentId}`);
    }
  }

  for (const item of creates) {
    const email = item.email.toLowerCase().trim();
    try {
      const [newParent] = await db
        .insert(parents)
        .values({ firstName: item.firstName, lastName: item.lastName, email })
        .returning();
      // Mirror the primary email into parent_emails right away, same
      // invariant POST /api/parents keeps -- see the schema comment on
      // parent_emails for why every parent needs a row there.
      await db.insert(parentEmails).values({ parentId: newParent.id, email, isPrimary: true });
      created++;
    } catch (err: unknown) {
      console.error(err);
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        errors.push(`"${item.firstName} ${item.lastName}" (${item.email}): that email is already in use`);
      } else {
        errors.push(`Couldn't create parent "${item.firstName} ${item.lastName}"`);
      }
    }
  }

  return NextResponse.json({ updated, created, errors });
}
