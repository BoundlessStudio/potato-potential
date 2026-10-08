import type { Metadata } from "next";

export { default } from "../page";

export const metadata: Metadata = {
  title: "Tasks — Potato Potential",
  alternates: { canonical: "/tasks" },
  robots: { index: false, follow: false },
};
