"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const SERIES_OPTIONS = [
  {
    value: "meter1:load_kw",
    label: "Demo 1 – Idealized Sine Load",
  },
  {
    value: "residential1:load_kw",
    label: "Demo 2 – Residential PV Complex",
  },
];

export function SeriesSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentSeries =
    searchParams.get("series") ?? SERIES_OPTIONS[0].value;

  // Fallbacks, falls keine Parameter gesetzt sind
  const historyHours = searchParams.get("history_hours") ?? "48";
  const horizonHours = searchParams.get("horizon_hours") ?? "48";

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextSeries = e.target.value;

    const params = new URLSearchParams(searchParams.toString());
    params.set("series", nextSeries);

    // sicherstellen, dass die anderen Parameter nicht verloren gehen
    if (!params.get("history_hours")) {
      params.set("history_hours", historyHours);
    }
    if (!params.get("horizon_hours")) {
      params.set("horizon_hours", horizonHours);
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-slate-400">
        Demo-Lastprofil
      </span>
      <select
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-sm text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        value={currentSeries}
        onChange={handleChange}
      >
        {SERIES_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

