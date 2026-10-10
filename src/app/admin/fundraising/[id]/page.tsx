import { db } from "@/db";
import {
  fundraisingContacts,
  fundraisingOutreach,
  fundraisingPartnerContacts,
  fundraisingPartners,
} from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFundraisingPage } from "@/lib/require-admin";
import { STATUS_BADGE_CLASSES, STATUS_LABELS, todayLocal } from "@/lib/fundraising";
import PartnerForm from "../PartnerForm";
import PartnerContacts from "./PartnerContacts";
import OutreachLog from "./OutreachLog";

export const dynamic = "force-dynamic";

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFundraisingPage();
  const { id } = await params;

  const [partner] = await db.select().from(fundraisingPartners).where(eq(fundraisingPartners.id, id));
  if (!partner) notFound();

  const linked = await db
    .select({
      id: fundraisingContacts.id,
      name: fundraisingContacts.name,
      email: fundraisingContacts.email,
      phone: fundraisingContacts.phone,
      role: fundraisingPartnerContacts.role,
      isPrimary: fundraisingPartnerContacts.isPrimary,
      isCurrent: fundraisingPartnerContacts.isCurrent,
    })
    .from(fundraisingPartnerContacts)
    .innerJoin(fundraisingContacts, eq(fundraisingPartnerContacts.contactId, fundraisingContacts.id))
    .where(eq(fundraisingPartnerContacts.partnerId, id))
    .orderBy(sql`lower(${fundraisingContacts.name})`);

  const allContacts = await db
    .select({ id: fundraisingContacts.id, name: fundraisingContacts.name, email: fundraisingContacts.email })
    .from(fundraisingContacts)
    .orderBy(sql`lower(${fundraisingContacts.name})`);

  const outreach = await db
    .select({
      id: fundraisingOutreach.id,
      date: fundraisingOutreach.date,
      ptoMember: fundraisingOutreach.ptoMember,
      note: fundraisingOutreach.note,
      contactName: fundraisingContacts.name,
    })
    .from(fundraisingOutreach)
    .leftJoin(fundraisingContacts, eq(fundraisingOutreach.contactId, fundraisingContacts.id))
    .where(eq(fundraisingOutreach.partnerId, id))
    // Newest first; undated (imported) entries sink to the bottom.
    .orderBy(sql`${fundraisingOutreach.date} desc nulls last`, desc(fundraisingOutreach.createdAt));

  return (
    <div className="p-6">
      <Link href="/admin/fundraising" className="text-sm text-blue-600">
        ← All partners
      </Link>
      <div className="flex items-center gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold">{partner.name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE_CLASSES[partner.status]}`}>
          {STATUS_LABELS[partner.status]}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div>
          <h2 className="text-lg font-semibold mb-2">Details</h2>
          {/* Keyed on the fields outreach logging can change, so the form
              picks up the new values after router.refresh() instead of
              holding stale state and writing it back on the next save. */}
          <PartnerForm key={`${partner.status}|${partner.followUpBy}`} initialData={partner} />
        </div>
        <PartnerContacts partnerId={partner.id} linked={linked} allContacts={allContacts} />
        <OutreachLog
          key={partner.followUpBy ?? ""}
          partnerId={partner.id}
          entries={outreach}
          contacts={linked.filter((c) => c.isCurrent).map((c) => ({ id: c.id, name: c.name }))}
          defaultPtoMember={partner.ptoOwner}
          currentFollowUpBy={partner.followUpBy}
          today={todayLocal()}
        />
      </div>
    </div>
  );
}
