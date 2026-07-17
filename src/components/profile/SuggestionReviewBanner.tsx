import { Alert } from "@/components/ui/primitives";
import { TARGET_ENTITY_LABEL } from "@/lib/resume-suggestions";
import type { PendingSuggestionsByEntity } from "@/lib/data/resume-suggestions";

/** Shown at the top of the profile page only when there are pending CV suggestions. */
export function SuggestionReviewBanner({
  groups,
  total,
}: {
  groups: PendingSuggestionsByEntity;
  total: number;
}) {
  if (total === 0) return null;
  const counts = Object.entries(groups)
    .filter(([, rows]) => rows.length > 0)
    .map(
      ([entity, rows]) =>
        `${rows.length} ${TARGET_ENTITY_LABEL[entity as keyof PendingSuggestionsByEntity].toLowerCase()}${rows.length > 1 ? " items" : ""}`,
    );

  return (
    <div className="mb-4">
      <Alert
        tone="brand"
        title={`We found ${total} update${total > 1 ? "s" : ""} from your CV — review them below.`}
      >
        {counts.length > 0 ? counts.join(" · ") : null}
      </Alert>
    </div>
  );
}
