import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasFundraisingAccess, isAdminEmail } from "@/lib/access-lists";

// For API route handlers: returns the session, or null so the route can
// respond 401 itself.
export async function requireAdmin() {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
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

// Fundraising pages and APIs: admins plus FUNDRAISING_EMAILS (see
// src/lib/access-lists.ts). Same null-vs-redirect split as above.
export async function requireFundraising() {
  const session = await auth();
  if (!hasFundraisingAccess(session?.user?.email)) {
    return null;
  }
  return session;
}

export async function requireFundraisingPage() {
  const session = await requireFundraising();
  if (!session) redirect("/sign-in?error=unauthorized");
  return session;
}
