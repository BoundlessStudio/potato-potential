import type { Metadata } from "next";

export { default } from "../page";

export const metadata: Metadata = {
  title: "Chat — Potato Potential",
  alternates: { canonical: "/chat" },
  robots: { index: false, follow: false },
};
