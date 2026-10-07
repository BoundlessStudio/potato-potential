import type { Metadata } from "next";
import { BetaWorkspace } from "@/components/beta-workspace";

export const metadata: Metadata = {
  title: "Beta list — Potato Potential",
  alternates: { canonical: "/beta" },
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function BetaPage() {
  return <BetaWorkspace />;
}
