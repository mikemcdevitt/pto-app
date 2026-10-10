import { db } from "@/db";
import { fundraisingContacts, fundraisingPartnerContacts, fundraisingPartners } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { requireFundraisingPage } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export default async function FundraisingContactsPage() {
  await requireFundraisingPage();

  const contacts = await db.select().from(fundraisingContacts).orderBy(sql`lower(${fundraisingContacts.name})`);
  const links = await db
    .select({
      contactId: fundraisingPartnerContacts.contactId,
      partnerId: fundraisingPartners.id,
      partnerName: fundraisingPartners.name,
      role: fundraisingPartnerContacts.role,
      isCurrent: fundraisingPartnerContacts.isCurrent,
    })
    .from(fundraisingPartnerContacts)
    .innerJoin(fundraisingPartners, eq(fundraisingPartnerContacts.partnerId, fundraisingPartners.id))
    .orderBy(sql`lower(${fundraisingPartners.name})`);

  const byContact = new Map<string, typeof links>();
  for (const l of links) {
    const list = byContact.get(l.contactId) ?? [];
    list.push(l);
    byContact.set(l.contactId, list);
  }

  return (
    <div className="p-6">
      <Link href="/admin/fundraising" className="text-sm text-blue-600">
        ← All partners
      </Link>
      <div className="flex justify-between items-center mt-2 mb-4">
        <h1 className="text-2xl font-bold">Contacts</h1>
        <Link href="/admin/fundraising/contacts/new" className="px-4 py-2 bg-blue-600 text-white rounded">
          Add Contact
        </Link>
      </div>

      {contacts.length === 0 ? (
        <p className="text-gray-500">No contacts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Name</th>
                <th className="p-2">Email</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Partners</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const partners = byContact.get(c.id) ?? [];
                return (
                  <tr key={c.id} className="border-b align-top">
                    <td className="p-2 font-medium">{c.name}</td>
                    <td className="p-2">{c.email && <a href={`mailto:${c.email}`} className="text-blue-600">{c.email}</a>}</td>
                    <td className="p-2">{c.phone}</td>
                    <td className="p-2">
                      {partners.length === 0 ? (
                        <span className="text-gray-400">None</span>
                      ) : (
                        <ul>
                          {partners.map((p) => (
                            <li key={p.partnerId} className={p.isCurrent ? "" : "text-gray-400"}>
                              <Link href={`/admin/fundraising/${p.partnerId}`} className="hover:underline">
                                {p.partnerName}
                              </Link>
                              {p.role && <span className="text-gray-500"> · {p.role}</span>}
                              {!p.isCurrent && <span> (former)</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="p-2">
                      <Link href={`/admin/fundraising/contacts/${c.id}`} className="text-blue-600">
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
