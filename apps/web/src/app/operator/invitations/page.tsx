import type { Metadata } from "next";
import { OperatorWorkspace } from "@/components/operator-workspace";

export const metadata: Metadata = {
  title: "Beta list — Boundless",
};

export default function InvitationsPage() {
  return <OperatorWorkspace />;
}
