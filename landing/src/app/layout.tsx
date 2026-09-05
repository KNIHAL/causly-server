import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import BackgroundGrid from "@/components/background-grid";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const siteUrl = "https://environment.causly.in";

const description =
  "Causly Agent Environment gives AI agents a secure execution environment to build, test, deploy, and operate real software and infrastructure.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title: {
    default: "Causly Agent Environment",
    template: "%s — Causly Agent Environment",
  },

  description,

  keywords: [
    "Causly Agent Environment",
    "AI agent environment",
    "AI execution environment",
    "MCP server",
    "AI DevOps",
    "AI coding agent",
    "Causly Server",
    "causly-server",
  ],

  openGraph: {
    title: "Causly Agent Environment",
    description,
    url: siteUrl,
    siteName: "Causly Agent Environment",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
      },
    ],
    locale: "en_US",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Causly Agent Environment",
    description,
    images: ["/og.png"],
  },

  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full flex flex-col bg-background text-foreground">
        <BackgroundGrid className="fixed inset-0 -z-10" />
        {children}
      </body>
    </html>
  );
}
