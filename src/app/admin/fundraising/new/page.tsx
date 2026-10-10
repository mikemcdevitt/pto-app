import Link from "next/link";
import { requireFundraisingPage } from "@/lib/require-admin";
import PartnerForm from "../PartnerForm";

export default async function NewPartnerPage() {
  await requireFundraisingPage();
  return (
    <div className="p-6 max-w-md">
      <Link href="/admin/fundraising" className="text-sm text-blue-600">
        ← All partners
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-4">Add Partner</h1>
      <PartnerForm />
      <p className="text-xs text-gray-500 mt-4">You can add contacts on the next page.</p>
    </div>
  );
}
