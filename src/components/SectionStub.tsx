import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { LayoutGrid } from "lucide-react";

/** Honest, consistent placeholder for a portal section that is planned but not
 *  yet built out. It never shows fake data — it explains what will live here. */
export function SectionStub({
  title,
  description,
  note,
}: {
  title: string;
  description?: string;
  note?: string;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<LayoutGrid className="h-8 w-8" />}
        title="Section scaffolded for the MVP"
        description={note ?? "This area is part of the platform structure. Its data model and navigation are in place; the detailed screen is planned for a later iteration."}
      />
    </div>
  );
}
