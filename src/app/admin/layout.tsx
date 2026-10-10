import Link from "next/link";
import { auth, signOut } from "@/auth";
import { isAdminEmail } from "@/lib/access-lists";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Only decides which nav links to show. Access itself is enforced by
  // src/proxy.ts and the require*Page() call in every page -- see the note
  // in src/lib/require-admin.ts on why layouts aren't used for auth.
  const session = await auth();
  const isAdmin = isAdminEmail(session?.user?.email);

  return (
    <div>
      <nav className="border-b p-4 flex justify-between items-center">
        <div className="flex gap-4">
          {isAdmin ? (
            <>
              <Link href="/admin" className="font-semibold">Admin</Link>
              <Link href="/admin/classrooms">Classrooms</Link>
              <Link href="/admin/parents">Parents</Link>
              <Link href="/admin/students">Students</Link>
              <Link href="/admin/families">Families</Link>
              <Link href="/admin/fundraising">Fundraising</Link>
            </>
          ) : (
            <Link href="/admin/fundraising" className="font-semibold">Fundraising</Link>
          )}
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/sign-in" });
          }}
        >
          <button type="submit" className="text-sm text-gray-600">Sign out</button>
        </form>
      </nav>
      <main>{children}</main>
    </div>
  );
}
