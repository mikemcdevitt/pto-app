import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export default auth(async (req) => {
  const path = req.nextUrl.pathname;
  const email = req.auth?.user?.email?.toLowerCase();

  const isAdminRoute = path.startsWith("/admin");
  const isParentRoute = path.startsWith("/parent");

  if (isAdminRoute) {
    if (!email || !adminEmails.includes(email)) {
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