import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "App connection — Potato Potential",
  alternates: { canonical: "/connected" },
  robots: { index: false, follow: false },
};

export default function ConnectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
