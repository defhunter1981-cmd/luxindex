import {
  Playfair_Display,
  Geist,
  JetBrains_Mono,
  Antonio,
  Manrope,
} from "next/font/google";
import "./globals.css";

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const antonio = Antonio({
  variable: "--font-antonio",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

// Canonical URL / metadataBase are driven purely by deployment configuration.
// When NEXT_PUBLIC_SITE_URL is unset (e.g. local dev), no canonical URL is
// emitted rather than guessing a production origin.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata = {
  ...(siteUrl
    ? { metadataBase: new URL(siteUrl), alternates: { canonical: "/" } }
    : {}),
  title: "Fernhollow × LuxeIndex | Editorial Beauty Price Index",
  description:
    "Explore the nocturnal botanical valley and compare verified beauty pricing across Sephora, Nykaa, Amazon Luxury, Cult Beauty, and Space NK.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${playfairDisplay.variable} ${geistSans.variable} ${jetbrainsMono.variable} ${antonio.variable} ${manrope.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-[#FAF8F5] text-zinc-900 antialiased selection:bg-orange-900/10 selection:text-zinc-900">
        {children}
      </body>
    </html>
  );
}
