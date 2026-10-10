import { redirect } from "next/navigation";
import { auth } from "@/auth";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// For API route handlers: returns the session, or null so the route can
// respond 401 itself.
export async function requireAdmin() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !adminEmails.includes(email)) {
    return null;
  }
  return session;
}

// For /admin pages: redirects to sign-in instead of returning null.
// src/proxy.ts already guards /admin, but every admin page calls
// this too, so a proxy gap (misconfigured matcher, a framework
// bypass bug) can't expose admin data on its own. Called from each
// page rather than from admin/layout.tsx on purpose: layouts don't
// re-run on client-side navigation, so a layout-only check isn't
// enforced on every request (see "Layouts and auth checks" in Next's
// authentication guide).
export async function requireAdminPage() {
  const session = await requireAdmin();
  if (!session) redirect("/sign-in?error=unauthorized");
  return session;
}
