import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { parents } from "@/db/schema";

// For /parent pages: returns the signed-in parent's row, or redirects to
// sign-in if there's no session or the email isn't a known parent. Same
// match as src/proxy.ts and post-sign-in (case-insensitive on
// parents.email), repeated here so the pages don't depend on the
// the proxy alone -- see requireAdminPage in require-admin.ts for why
// it's called per page rather than from a layout.
export async function requireParentPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/sign-in");

  const [parent] = await db
    .select()
    .from(parents)
    .where(sql`lower(${parents.email}) = ${email}`)
    .limit(1);
  if (!parent) redirect("/sign-in?error=unauthorized");

  return { session, parent };
}
