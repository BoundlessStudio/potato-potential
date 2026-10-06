import type { Metadata } from "next";
import { OperatorWorkspace } from "@/components/operator-workspace";

export const metadata: Metadata = { title: "Beta operations — Boundless" };

export default function OperatorPage() {
  return <OperatorWorkspace operations />;
}
