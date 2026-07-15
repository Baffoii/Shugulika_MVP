import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Shugulika Africa — Recruitment Platform",
    template: "%s · Shugulika",
  },
  description:
    "Shugulika Africa — a pan-African job portal, franchise platform, and applicant tracking system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
