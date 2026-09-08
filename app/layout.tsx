import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NavRail } from "./NavRail";

export const metadata: Metadata = {
  title: "SnipAi",
  description: "Review and approve AI-edited video cuts before they post.",
  manifest: "/manifest.json",
  // Add to Home Screen on iOS: launches fullscreen with its own icon,
  // no Safari chrome.
  appleWebApp: {
    capable: true,
    title: "SnipAi",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-256.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#14161b",
  width: "device-width",
  initialScale: 1,
  // let content sit under the notch/home indicator, handled by safe-area insets
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <NavRail />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
