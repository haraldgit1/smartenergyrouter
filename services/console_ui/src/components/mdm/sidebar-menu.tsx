// src/components/mdm/sidebar-menu.tsx
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { MenuItem } from "@/lib/api";
import { Layers } from "lucide-react"; // kleines Icon für Brand-Bereich

interface SidebarMenuProps {
  items: MenuItem[];
}

const SECTION_ORDER = [
  "Overview",
  "Masterdata",
  "Monitoring",
  "Execution",
  "Settlement",
];

export default function SidebarMenu({ items }: SidebarMenuProps) {
  const sections = useMemo(() => {
    const unique = Array.from(new Set(items.map((m) => m.section)));

    return unique.sort((a, b) => {
      const ia = SECTION_ORDER.indexOf(a);
      const ib = SECTION_ORDER.indexOf(b);

      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;

      return ia - ib;
    });
  }, [items]);

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const s of sections) {
      initial[s] = s === "Overview"; // nur Overview offen
    }
    return initial;
  });

  const toggleSection = (section: string) => {
    setOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-950/60 p-4 space-y-4">
      
      {/* --------------------------------------------- */}
      {/* Header / Logo / Home-Link */}
      {/* --------------------------------------------- */}
      <Link
        href="/"
        className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-slate-900 transition-colors"
        title="Zur Startseite"
      >
        <Layers className="h-6 w-6 text-sky-400" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-slate-50">
            Smart Energy
          </span>
          <span className="text-xs text-slate-400">Router Console</span>
        </div>
      </Link>

      {/* Falls du hinter dem Titel noch z.B. ENV anzeigen willst */}
      <div className="px-2 text-[10px] text-slate-500 uppercase tracking-wider">
        {/* Beispiel: "PROD", "DEV", "AWS", ... */}
        {/* ENV wird später dynamisch eingebaut */}
      </div>

      {/* --------------------------------------------- */}
      {/* Sektionen */}
      {/* --------------------------------------------- */}
      {sections.map((section) => {
        const sectionItems = items
          .filter((m) => m.section === section)
          .sort(
            (a, b) =>
              a.sort_order - b.sort_order ||
              a.menu_key.localeCompare(b.menu_key)
          );

        if (!sectionItems.length) return null;

        const isOpen = open[section];

        return (
          <div key={section} className="space-y-1">
            {/* Section-Header */}
            <button
              type="button"
              onClick={() => toggleSection(section)}
              className="flex w-full items-center text-[11px] uppercase tracking-wide text-slate-500 mt-3 mb-1 hover:text-slate-300"
            >
              {/* Größeres Pfeil-Symbol links */}
              <span className="mr-2 text-[16px] leading-none">
                {isOpen ? "▾" : "▸"}
              </span>
              <span className="flex-1 text-left">{section}</span>
            </button>

            {isOpen && (
              <div className="space-y-0.5">
                {sectionItems.map((m) => (
                  <Link
                    key={m.menu_key}
                    href={m.route_path}
                    className="block text-sm px-4 py-1.5 rounded-md hover:bg-slate-800 text-slate-200"
                    title={m.description ?? ""}
                  >
                    {m.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}

