import { db } from "@/db";
import { fundraisingContacts, fundraisingPartnerContacts, fundraisingPartners } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { requireFundraisingPage } from "@/lib/require-admin";
import {
  FUNDRAISING_STATUSES,
  STATUS_BADGE_CLASSES,
  STATUS_LABELS,
  formatDate,
  isStatus,
  todayLocal,
  websiteHref,
} from "@/lib/fundraising";

export const dynamic = "force-dynamic";

// "due" isn't a status -- it's partners whose follow-up date is today or past.
type Filter = (typeof FUNDRAISING_STATUSES)[number] | "due" | "all";

export default async function FundraisingDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireFundraisingPage();
  const { status, q } = await searchParams;
  const filter: Filter = status === "due" || isStatus(status) ? status : "all";
  const query = (q ?? "").trim().toLowerCase();
  const today = todayLocal();

  const partners = await db.select().from(fundraisingPartners).orderBy(sql`lower(${fundraisingPartners.name})`);

  // Current contacts only -- former ones show on the partner's own page.
  const links = await db
    .select({
      partnerId: fundraisingPartnerContacts.partnerId,
      contactId: fundraisingContacts.id,
      name: fundraisingContacts.name,
      email: fundraisingContacts.email,
      phone: fundraisingContacts.phone,
      role: fundraisingPartnerContacts.role,
      isPrimary: fundraisingPartnerContacts.isPrimary,
    })
    .from(fundraisingPartnerContacts)
    .innerJoin(fundraisingContacts, eq(fundraisingPartnerContacts.contactId, fundraisingContacts.id))
    .where(eq(fundraisingPartnerContacts.isCurrent, true))
    .orderBy(sql`lower(${fundraisingContacts.name})`);

  const contactsByPartner = new Map<string, typeof links>();
  for (const link of links) {
    const list = contactsByPartner.get(link.partnerId) ?? [];
    list.push(link);
    contactsByPartner.set(link.partnerId, list);
  }
  for (const list of contactsByPartner.values()) {
    list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  }

  const isDue = (p: (typeof partners)[number]) => p.followUpBy !== null && p.followUpBy <= today;

  const counts: Record<Filter, number> = { all: partners.length, due: 0, prospective: 0, contacted: 0, active: 0, inactive: 0 };
  for (const p of partners) {
    counts[p.status] += 1;
    if (isDue(p)) counts.due += 1;
  }

  const visible = partners.filter((p) => {
    if (filter === "due" ? !isDue(p) : filter !== "all" && p.status !== filter) return false;
    if (!query) return true;
    const people = contactsByPartner.get(p.id) ?? [];
    return (
      p.name.toLowerCase().includes(query) ||
      (p.ptoOwner ?? "").toLowerCase().includes(query) ||
      people.some((c) => c.name.toLowerCase().includes(query) || (c.email ?? "").includes(query))
    );
  });

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "due", label: "Follow-up due" },
    ...FUNDRAISING_STATUSES.map((s) => ({ key: s as Filter, label: STATUS_LABELS[s] })),
  ];

  function tabHref(key: Filter) {
    const params = new URLSearchParams();
    if (key !== "all") params.set("status", key);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/admin/fundraising?${qs}` : "/admin/fundraising";
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <h1 className="text-2xl font-bold">Fundraising Partners</h1>
        <div className="flex gap-2">
          <Link href="/admin/fundraising/contacts" className="px-4 py-2 border rounded">
            All Contacts
          </Link>
          <Link href="/admin/fundraising/new" className="px-4 py-2 bg-blue-600 text-white rounded">
            Add Partner
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`px-3 py-1 rounded-full text-sm border ${
              filter === t.key ? "bg-gray-900 text-white border-gray-900" : "hover:bg-gray-50"
            } ${t.key === "due" && counts.due > 0 && filter !== "due" ? "border-red-300 text-red-700" : ""}`}
          >
            {t.label} <span className="opacity-70">{counts[t.key]}</span>
          </Link>
        ))}
        <form method="get" className="ml-auto flex gap-2">
          {filter !== "all" && <input type="hidden" name="status" value={filter} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search partners, people, PTO owner"
            className="border rounded p-2 text-sm w-64"
          />
          <button type="submit" className="px-3 py-2 border rounded text-sm">Search</button>
        </form>
      </div>

      {visible.length === 0 ? (
        <p className="text-gray-500">
          {partners.length === 0 ? "No partners yet. Add one, or run the spreadsheet import." : "No partners match."}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((p) => {
            const people = contactsByPartner.get(p.id) ?? [];
            const due = isDue(p);
            return (
              <div key={p.id} className="border rounded-lg p-4 shadow-sm flex flex-col gap-3">
                <div className="flex justify-between items-start gap-2">
                  <Link href={`/admin/fundraising/${p.id}`} className="font-semibold text-lg hover:underline">
                    {p.name}
                  </Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_BADGE_CLASSES[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </div>

                {people.length === 0 ? (
                  <p className="text-sm text-gray-400">No contact on file</p>
                ) : (
                  <ul className="space-y-2">
                    {people.map((c) => (
                      <li key={c.contactId} className="text-sm">
                        <p>
                          <span className="font-medium">{c.name}</span>
                          {c.isPrimary && <span className="ml-1 text-xs text-blue-700">primary</span>}
                          {c.role && <span className="text-gray-500"> · {c.role}</span>}
                        </p>
                        <p className="text-gray-600 flex flex-wrap gap-x-3">
                          {c.email && <a href={`mailto:${c.email}`} className="text-blue-600 break-all">{c.email}</a>}
                          {c.phone && <a href={`tel:${c.phone}`} className="text-blue-600">{c.phone}</a>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-auto pt-2 border-t text-sm text-gray-600 space-y-1">
                  {p.website && (
                    <p>
                      <a href={websiteHref(p.website)} target="_blank" rel="noreferrer" className="text-blue-600 break-all">
                        {p.website}
                      </a>
                    </p>
                  )}
                  <p className="flex justify-between gap-2">
                    <span>{p.ptoOwner ? `PTO: ${p.ptoOwner}` : <span className="text-gray-400">No PTO owner</span>}</span>
                    {p.followUpBy && (
                      <span className={due ? "text-red-700 font-medium" : ""}>
                        {due ? "Follow-up due " : "Follow up by "}
                        {formatDate(p.followUpBy)}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
