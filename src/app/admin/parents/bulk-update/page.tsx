import BulkUpdateForm from "./BulkUpdateForm";

export default function BulkUpdatePage() {
  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">Bulk Update Parents</h1>
      <p className="text-gray-600 mb-4">
        Paste rows copied from Excel, or load a CSV file -- either way, nothing is uploaded or
        saved anywhere until you review the results below and apply them. Expected columns, in
        order: First Name, Last Name, Email. Matching is by email (checked against every email on
        file for a parent, not just their primary).
      </p>
      <BulkUpdateForm />
    </div>
  );
}
