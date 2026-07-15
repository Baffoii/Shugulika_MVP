import { PublicHeader } from "@/components/layout/PublicHeader";
import { ButtonLink, Card } from "@/components/ui/primitives";
import { JobCard } from "@/components/jobs/JobCard";
import { listPublicJobs } from "@/lib/data/jobs";
import { Search, ShieldCheck, Users, Building2 } from "lucide-react";

export default async function LandingPage() {
  const { jobs, configured } = await listPublicJobs({});
  const featured = jobs.slice(0, 3);

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      {/* Hero */}
      <section className="border-b border-surface-border bg-gradient-to-b from-brand-50/60 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="mb-3 inline-flex rounded-badge bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">
            Pan-African recruitment · Now live in Tanzania
          </p>
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight text-ink sm:text-4xl">
            Opportunities across the continent, from one trusted platform.
          </h1>
          <p className="mt-4 max-w-xl text-base text-ink-muted">
            Shugulika connects job seekers, employers, and recruitment franchises — a job portal, a
            franchise network, and an applicant tracking system working as one.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/jobs" size="md">
              <Search className="h-4 w-4" /> Browse jobs
            </ButtonLink>
            <ButtonLink href="/auth/sign-up" variant="outline" size="md">
              Create a candidate profile
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Audiences */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Users, title: "For job seekers", body: "Build one reusable profile, apply in minutes, and track every application with clear status updates." },
            { icon: Building2, title: "For employers", body: "Post roles, review masked candidate submissions, and hire directly or through a Shugulika recruiter." },
            { icon: ShieldCheck, title: "For franchises & HQ", body: "One standardized pipeline across countries with consent, audit, and privacy built in." },
          ].map((a) => (
            <Card key={a.title} className="p-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <a.icon className="h-5 w-5" aria-hidden />
              </div>
              <h2 className="text-sm font-semibold text-ink">{a.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{a.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Featured jobs */}
      <section className="border-t border-surface-border bg-surface-muted">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Featured roles</h2>
            <ButtonLink href="/jobs" variant="ghost" size="sm">View all jobs →</ButtonLink>
          </div>
          {configured && featured.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {featured.map((job) => (
                <JobCard key={job.job_id} job={job} />
              ))}
            </div>
          ) : (
            <Card className="p-6 text-sm text-ink-muted">
              {configured
                ? "No advertised roles yet. Check back soon."
                : "Connect the database to see live roles — run the SQL in supabase/migrations/ (see README)."}
            </Card>
          )}
        </div>
      </section>

      <footer className="border-t border-surface-border bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-ink-subtle sm:px-6">
          © {new Date().getFullYear()} Shugulika Africa. Demo MVP — data shown is illustrative.
        </div>
      </footer>
    </div>
  );
}
