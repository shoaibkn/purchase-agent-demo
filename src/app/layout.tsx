import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Purchase Agent Demo",
  description: "Automated supplier communication for procurement workflows",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
