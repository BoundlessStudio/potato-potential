import type { Metadata } from "next";

export { default } from "../page";

export const metadata: Metadata = {
  title: "Routines — Potato Potential",
  alternates: { canonical: "/routines" },
  robots: { index: false, follow: false },
};
