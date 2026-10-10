import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import authConfig from "@/auth.config";
import { hasFundraisingAccess, isAdminEmail, isFundraisingPath } from "@/lib/access-lists";

// Next.js 16 "proxy" (formerly middleware.ts -- same behavior, renamed
// file convention). Builds its own NextAuth instance from the lightweight
// config only (no adapter, no Nodemailer) -- see src/auth.config.ts for why.
// Proxy runs on the Node.js runtime in Next 16, so the edge-safe split is no
// longer strictly required, but it keeps this file free of the DB adapter.
const { auth } = NextAuth(authConfig);


export default auth(async (req) => {
  const path = req.nextUrl.pathname;
  const email = req.auth?.user?.email?.toLowerCase();

  const isAdminRoute = path.startsWith("/admin");
  const isParentRoute = path.startsWith("/parent");

  if (isAdminRoute) {
    // /admin/fundraising is open to the fundraising list as well as admins;
    // everything else under /admin is admins only. A fundraising-only user
    // landing on /admin itself (e.g. after sign-in) is sent to their page
    // rather than shown "unauthorized".
    const allowed = isFundraisingPath(path) ? hasFundraisingAccess(email) : isAdminEmail(email);
    if (!allowed) {
      if (path === "/admin" && hasFundraisingAccess(email)) {
        return NextResponse.redirect(new URL("/admin/fundraising", req.nextUrl.origin));
      }
      const url = new URL("/sign-in", req.nextUrl.origin);
      url.searchParams.set("callbackUrl", path);
      if (email) url.searchParams.set("error", "unauthorized");
      return NextResponse.redirect(url);
    }
  }

  if (isParentRoute) {
    if (!email) {
      const url = new URL("/sign-in", req.nextUrl.origin);
      url.searchParams.set("callbackUrl", path);
      return NextResponse.redirect(url);
    }
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`SELECT 1 FROM parents WHERE lower(email) = ${email} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.redirect(
        new URL("/sign-in?error=unauthorized", req.nextUrl.origin)
      );
    }
  }
});

export const config = {
  matcher: ["/admin/:path*", "/parent/:path*"],
};
