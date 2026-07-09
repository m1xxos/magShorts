import type { Metadata } from "next";
import { Geist, Inter, Lora } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Geist has no Cyrillic glyphs; Inter fills them in via the font stack.
const interCyrillic = Inter({
  variable: "--font-inter",
  subsets: ["cyrillic"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "magShorts — your articles, one calm feed",
  description:
    "A cozy YouTube-style reader for articles: subscribe to publications and flip through them like shorts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${interCyrillic.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
