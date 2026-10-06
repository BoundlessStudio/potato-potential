import type { Metadata } from "next";
import { OperatorWorkspace } from "@/components/operator-workspace";

export const metadata: Metadata = {
  title: "Beta list — Potato Potential",
};

export default function InvitationsPage() {
  return <OperatorWorkspace />;
}
