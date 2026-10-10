import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIRA — AI Market Intelligence",
  description: "Ask prediction markets anything. MIRA searches, compares and explains market data so you can see the evidence.",
  applicationName: "MIRA",
};

export const viewport: Viewport = {
  themeColor: "#eff6e8",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
