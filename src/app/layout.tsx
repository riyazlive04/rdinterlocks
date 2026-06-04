import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "RD Interlock — Factory OS",
  description: "Daily operations, stock, workers, and cashbook for RD Interlock brick factory.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0E2143",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-paper text-ink font-ui" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
