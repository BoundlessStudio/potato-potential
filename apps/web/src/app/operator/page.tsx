import type { Metadata } from "next";
import { OperatorWorkspace } from "@/components/operator-workspace";

export const metadata: Metadata = {
  title: "Beta operations — Potato Potential",
};

export default function OperatorPage() {
  return <OperatorWorkspace operations />;
}
