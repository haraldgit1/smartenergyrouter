// src/app/devices/page.tsx
import { getDevices, type Device, CONSOLE_API_BASE_URL } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Printer } from "lucide-react";

export const dynamic = "force-dynamic";

type ListExportProps = {
  entity: string;         // "devices"
  currentSearch?: string; // später für Suche nutzbar
};

// Buttons für PDF/CSV-Liste
function ListExportButton({ entity, currentSearch }: ListExportProps) {
  const base = `${CONSOLE_API_BASE_URL}/mdm/reports/${entity}`;

  const search = currentSearch
    ? `?q=${encodeURIComponent(currentSearch)}`
    : "";

  const pdfUrl = `${base}/list.pdf${search}`;
  const csvUrl = `${base}/list.csv${search}`;

  return (
    <div className="flex items-center gap-1">
      <a
        href={pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 hover:bg-slate-800 text-[11px]"
        title="Liste als PDF drucken"
      >
        <Printer className="h-3 w-3" />
        <span>PDF</span>
      </a>
      <a
        href={csvUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 hover:bg-slate-800 text-[11px]"
        title="Liste als CSV/Excel exportieren"
      >
        <Printer className="h-3 w-3" />
        <span>CSV</span>
      </a>
    </div>
  );
}

export default async function DevicesPage() {
  const devices = await getDevices();

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Devices</h1>
          <p className="text-sm text-slate-400">
            Stammdaten der angeschlossenen Geräte (technische Sicht).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {devices.length} Device(s)
          </span>
          <ListExportButton entity="devices" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {devices.map((d: Device) => (
          <Card
            key={d.device_id}
            className="border-slate-800 bg-slate-950/70 hover:border-slate-600 transition-colors"
          >
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    {d.name ?? d.device_id}
                  </div>
                  <div className="text-xs text-slate-400">
                    ID:{" "}
                    <span className="font-mono">
                      {d.device_id}
                    </span>{" "}
                    · {d.type ?? "type: n/a"} ·{" "}
                    {d.location ?? "no location"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    variant={d.mode === "live" ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {d.mode ?? "n/a"}
                  </Badge>
                  <Badge
                    variant={d.enabled ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {d.enabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
              </div>

              <div className="flex justify-between items-center text-[11px] text-slate-400">
                <span>
                  Backend: {d.backend_type ?? "n/a"} ·{" "}
                  {d.backend_ref ?? "-"}
                </span>
                <Link
                  href={`/devices/${encodeURIComponent(d.device_id)}`}
                  className="text-sky-400 hover:text-sky-300"
                >
                  &rarr; Details
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}

        {devices.length === 0 && (
          <div className="text-xs text-slate-500">
            Keine Devices gefunden.
          </div>
        )}
      </div>
    </div>
  );
}

