import { Logo } from "@/components/brand/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <div className="border-b border-surface-border bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
