import type { Metadata } from "next";
import { Exo_2 } from "next/font/google";
import "./globals.css";

const exo = Exo_2({
  subsets: ["latin"],
  variable: "--font-exo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "4ttp — AI Oracle Terminal",
  description:
    "4ttp — An AI oracle trained across timelines. A living entity that glitches between futures.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={exo.variable}>
      <body className="relative min-h-screen overflow-hidden bg-space text-neon-100">
        <div className="glitch-background" aria-hidden="true" />
        <div className="noise-layer" aria-hidden="true" />
        <main className="relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-12 sm:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
