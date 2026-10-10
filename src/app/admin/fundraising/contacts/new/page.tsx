import Link from "next/link";
import { requireFundraisingPage } from "@/lib/require-admin";
import ContactForm from "../ContactForm";

export default async function NewContactPage() {
  await requireFundraisingPage();
  return (
    <div className="p-6 max-w-md">
      <Link href="/admin/fundraising/contacts" className="text-sm text-blue-600">
        ← All contacts
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-4">Add Contact</h1>
      <ContactForm />
      <p className="text-xs text-gray-500 mt-4">
        To link someone to a business, add them from that partner&apos;s page.
      </p>
    </div>
  );
}
