import { auth } from "@/auth";
import { db } from "@/db";
import { parents } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { hasFundraisingAccess, isAdminEmail } from "@/lib/access-lists";

export default async function PostSignInPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();

  if (!email) redirect("/sign-in");

  if (isAdminEmail(email)) {
    redirect("/admin");
  }

  if (hasFundraisingAccess(email)) {
    redirect("/admin/fundraising");
  }

  const [parent] = await db
    .select()
    .from(parents)
    .where(sql`lower(${parents.email}) = ${email}`);
  if (parent) {
    redirect("/parent/dashboard");
  }

  redirect("/sign-in?error=unauthorized");
}