import Link from "next/link";
import { signOut } from "@/auth";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="border-b p-4 flex justify-between items-center">
        <div className="flex gap-4">
          <Link href="/admin" className="font-semibold">Admin</Link>
          <Link href="/admin/classrooms">Classrooms</Link>
          <Link href="/admin/parents">Parents</Link>
          <Link href="/admin/students">Students</Link>
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