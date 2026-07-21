import { redirect } from "next/navigation";

export const metadata = { title: "Reports" };

/** Reports stub replaced by the KPI dashboard. */
export default function RecruiterReportsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<
    string,
    string | string[] | undefined
  >;
}) {
  // Preserve query string if any
  void searchParams;
  redirect("/recruiter/kpis");
}
