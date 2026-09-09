import Link from "next/link";

export default function AdminHomePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Admin</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/admin/classrooms" className="border rounded-lg p-4 shadow-sm hover:bg-gray-50">
          <p className="font-semibold text-lg">Classrooms</p>
          <p className="text-sm text-gray-600 mt-1">Manage grade, teacher, and abbreviation records.</p>
        </Link>
        <Link href="/admin/parents" className="border rounded-lg p-4 shadow-sm hover:bg-gray-50">
          <p className="font-semibold text-lg">Parents</p>
          <p className="text-sm text-gray-600 mt-1">Manage parent contacts and linked children.</p>
        </Link>
        <Link href="/admin/students" className="border rounded-lg p-4 shadow-sm hover:bg-gray-50">
          <p className="font-semibold text-lg">Students</p>
          <p className="text-sm text-gray-600 mt-1">Manage student records.</p>
        </Link>
      </div>
    </div>
  );
}