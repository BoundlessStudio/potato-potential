import type { Metadata } from "next";
import { PublicEntry } from "@/components/public-entry";

export const metadata: Metadata = { title: "Sign in — Boundless" };

export default function SignInPage() {
  return <PublicEntry signIn />;
}
