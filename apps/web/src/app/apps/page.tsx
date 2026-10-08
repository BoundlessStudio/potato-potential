import type { Metadata } from "next";

export { default } from "../page";

export const metadata: Metadata = {
  title: "Apps — Potato Potential",
  alternates: { canonical: "/apps" },
  robots: { index: false, follow: false },
};
