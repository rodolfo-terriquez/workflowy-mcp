import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workflowy MCP",
  description: "Remote self-hosted MCP access to Workflowy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
