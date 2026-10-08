import type { Metadata } from "next";

export { default } from "../page";

export const metadata: Metadata = {
  title: "Wiki — Potato Potential",
  alternates: { canonical: "/wiki" },
  robots: { index: false, follow: false },
};
