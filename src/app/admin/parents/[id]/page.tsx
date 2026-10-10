import { db } from "@/db";
import { parents, parentStudents, parentEmails, students } from "@/db/schema";
import { and, asc, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import ParentForm from "../ParentForm";
import { requireAdminPage } from "@/lib/require-admin";

// Always hit the database on request; this route has no dynamic
// function calls (no auth()/cookies()/searchParams), so Next.js would
// otherwise be free to statically prerender it once and keep serving
// that snapshot until the next deploy -- meaning new/edited parents
// or students wouldn't show up here without a redeploy.
export const dynamic = "force-dynamic";


export default async function EditParentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const [parent] = await db.select().from(parents).where(eq(parents.id, id));
  if (!parent) notFound();

  const allStudents = await db.select().from(students).orderBy(asc(students.lastName), asc(students.firstName));

  const linked = await db
    .select({ studentId: parentStudents.studentId })
    .from(parentStudents)
    .where(eq(parentStudents.parentId, id));

  // parents.email is the source of truth for "primary" -- parent_emails
  // gets fully rewritten from the form on every save (see PATCH
  // /api/parents/[id]), so we build the display list from parents.email
  // plus whatever's left in parent_emails, rather than trusting is_primary
  // there to already agree with it.
  const additionalEmailRows = await db
    .select({ email: parentEmails.email })
    .from(parentEmails)
    .where(and(eq(parentEmails.parentId, id), ne(parentEmails.email, parent.email)));

  const emails = [
    { email: parent.email, isPrimary: true },
    ...additionalEmailRows.map((r) => ({ email: r.email, isPrimary: false })),
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold p-6 pb-0">Edit Parent</h1>
      <ParentForm
        allStudents={allStudents}
        initialData={{ ...parent, studentIds: linked.map((l) => l.studentId), emails }}
      />
    </div>
  );
}