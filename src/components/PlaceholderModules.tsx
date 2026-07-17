import { PageHeader, Alert } from "@/components/ui/primitives";
import { PlaceholderCard } from "@/components/PlaceholderCard";
import { placeholdersForPortal, type Portal } from "@/lib/constants";

/** Standard page for a portal's later-phase integrations. */
export function PlaceholderModules({
  portal,
  title,
  description,
  only,
}: {
  portal: Portal;
  title: string;
  description?: string;
  only?: string[];
}) {
  let features = placeholdersForPortal(portal);
  if (only) features = features.filter((f) => only.includes(f.key));
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Alert tone="info" title="Not enabled in this MVP">
        These are later-phase capabilities. Their place in the product is reserved and the data
        model is ready, but the integrations aren&apos;t connected yet — no actions here produce
        real results.
      </Alert>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <PlaceholderCard key={f.key} feature={f} />
        ))}
      </div>
    </div>
  );
}
