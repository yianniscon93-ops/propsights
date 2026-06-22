import type { Metadata } from "next";
import { Inter, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  weight: ["600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PropSights — Cyprus STR Market Intelligence",
  description:
    "Live market intelligence for every short-term rental in Cyprus. Know what every area actually earns.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "PropSights — Cyprus STR Market Intelligence",
    description: "Turn Cyprus property data into confident decisions.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PropSights — Cyprus STR Market Intelligence",
    description: "Turn Cyprus property data into confident decisions.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${barlowCondensed.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
