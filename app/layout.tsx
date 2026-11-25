import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font" });

export const metadata: Metadata = {
  title: "Coldkite",
  description: "Paste a job post, get a tailored application email from the AI of your choice, send it from your own inbox. Open source; your keys stay in your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
