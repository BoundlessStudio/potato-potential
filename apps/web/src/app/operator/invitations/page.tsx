import type { Metadata } from "next";
import { OperatorWorkspace } from "@/components/operator-workspace";

export const metadata: Metadata = {
  title: "Beta list — Potato Potential",
  alternates: { canonical: "/operator/invitations" },
  robots: { index: false, follow: false },
};

export default function InvitationsPage() {
  return <OperatorWorkspace />;
}
