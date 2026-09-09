import { auth } from "@/auth";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function requireAdmin() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !adminEmails.includes(email)) {
    return null;
  }
  return session;
}