import type { Metadata } from "next";
import { PublicEntry } from "@/components/public-entry";

export const metadata: Metadata = {
  title: "Sign in — Potato Potential",
  description:
    "Sign in to your Potato Potential workspace with a passwordless email link.",
  alternates: { canonical: "/signin" },
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return <PublicEntry signIn />;
}
