import StudentForm from "../StudentForm";
import { requireAdminPage } from "@/lib/require-admin";

export default async function NewStudentPage() {
  await requireAdminPage();
  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Add Student</h1>
      <StudentForm />
    </div>
  );
}