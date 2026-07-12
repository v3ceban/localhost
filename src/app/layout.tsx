import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Geist, Geist_Mono } from "next/font/google";
import { ModelCacheProvider } from "@/hooks/use-model-cache";
import { Toaster } from "@/components/ui/sonner";
import "@/app/styles.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "localhost/%s",
    default: "localhost/chat",
  },
  description: "Yet another AI chat app. Now with client inference!",
  appleWebApp: { title: "localhost://" },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        <ModelCacheProvider>
          {children}
          <Toaster />
        </ModelCacheProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
