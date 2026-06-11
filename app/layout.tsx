import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "./components/Sidebar";

export const metadata: Metadata = {
  title: "Instagram Manager",
  description: "Scrape, track and analyze Instagram reels",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
