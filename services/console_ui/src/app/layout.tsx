// src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getMenu } from "@/lib/api";
import SidebarMenu from "@/components/mdm/sidebar-menu";

export const metadata: Metadata = {
  title: "Smart Energy Router Console",
  description: "MDM, Monitoring und Execution für den Smart Energy Router",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const menu = await getMenu();

  return (
    <html lang="de">
      <body className="bg-slate-950 text-slate-100">
        <div className="min-h-screen flex">
          {/* Sidebar mit auf-/zuklappbaren Sektionen */}
          <SidebarMenu items={menu} />

          {/* Hauptbereich */}
          <main className="flex-1 p-4">{children}</main>
        </div>
      </body>
    </html>
  );
}

