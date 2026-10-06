import type { Metadata } from "next";
import { OperatorWorkspace } from "@/components/operator-workspace";

export const metadata: Metadata = {
  title: "Beta operations — Potato Potential",
  alternates: { canonical: "/operator" },
  robots: { index: false, follow: false },
};

export default function OperatorPage() {
  return <OperatorWorkspace operations />;
}
