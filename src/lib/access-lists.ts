// Email allowlists for the admin area, shared by src/proxy.ts and
// src/lib/require-admin.ts. Kept free of any auth/db imports so the proxy
// can use it without pulling in the Drizzle adapter.
//
// ADMIN_EMAILS       -- full admin: every /admin page and API.
// FUNDRAISING_EMAILS -- fundraising only: /admin/fundraising and
//                       /api/fundraising, nothing with family/student data.
// Admins always have fundraising access too.

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const adminEmails = parseList(process.env.ADMIN_EMAILS);
const fundraisingEmails = parseList(process.env.FUNDRAISING_EMAILS);

export function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email) && adminEmails.includes(email!.toLowerCase());
}

export function hasFundraisingAccess(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return adminEmails.includes(e) || fundraisingEmails.includes(e);
}

export function isFundraisingPath(path: string): boolean {
  return path === "/admin/fundraising" || path.startsWith("/admin/fundraising/");
}
