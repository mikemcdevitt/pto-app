import { auth } from "@/auth";
import { db } from "@/db";
import { parents } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export default async function PostSignInPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();

  if (!email) redirect("/sign-in");

  if (adminEmails.includes(email)) {
    redirect("/admin");
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