import { db } from "@/db";
import { fundraisingContacts, fundraisingPartnerContacts, fundraisingPartners } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFundraisingPage } from "@/lib/require-admin";
import ContactForm from "../ContactForm";

export const dynamic = "force-dynamic";

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFundraisingPage();
  const { id } = await params;

  const [contact] = await db.select().from(fundraisingContacts).where(eq(fundraisingContacts.id, id));
  if (!contact) notFound();

  const partners = await db
    .select({
      id: fundraisingPartners.id,
      name: fundraisingPartners.name,
      role: fundraisingPartnerContacts.role,
      isPrimary: fundraisingPartnerContacts.isPrimary,
      isCurrent: fundraisingPartnerContacts.isCurrent,
    })
    .from(fundraisingPartnerContacts)
    .innerJoin(fundraisingPartners, eq(fundraisingPartnerContacts.partnerId, fundraisingPartners.id))
    .where(eq(fundraisingPartnerContacts.contactId, id))
    .orderBy(sql`lower(${fundraisingPartners.name})`);

  return (
    <div className="p-6 max-w-md">
      <Link href="/admin/fundraising/contacts" className="text-sm text-blue-600">
        ← All contacts
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-4">{contact.name}</h1>
      <ContactForm initialData={contact} linkedPartnerCount={partners.length} />

      <h2 className="text-lg font-semibold mt-8 mb-2">Partners</h2>
      {partners.length === 0 ? (
        <p className="text-sm text-gray-400">Not linked to any partner. Add them from a partner&apos;s page.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {partners.map((p) => (
            <li key={p.id} className={p.isCurrent ? "" : "text-gray-400"}>
              <Link href={`/admin/fundraising/${p.id}`} className="text-blue-600 hover:underline">
                {p.name}
              </Link>
              {p.role && <span className="text-gray-500"> · {p.role}</span>}
              {p.isPrimary && <span className="text-blue-700"> · primary</span>}
              {!p.isCurrent && <span> (former)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
