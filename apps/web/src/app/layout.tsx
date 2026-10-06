import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Potato Potential — a little help, a lot of possibility",
  description:
    "Your own personal agent. A little curious. Always in your corner.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
