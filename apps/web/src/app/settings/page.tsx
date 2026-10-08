import type { Metadata } from "next";

export { default } from "../page";

export const metadata: Metadata = {
  title: "Settings — Potato Potential",
  alternates: { canonical: "/settings" },
  robots: { index: false, follow: false },
};
