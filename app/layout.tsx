import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal Grove — Small moves. Wild territory.",
  description: "Grow your corner. Follow the signal. A quick shared-board strategy game for 2–4 humans and HTTP agents. No signup, just a little strategy.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
