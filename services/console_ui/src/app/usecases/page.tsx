// app/usecases/page.tsx
import { getUsecases, CONSOLE_API_BASE_URL } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Printer } from "lucide-react";

export const dynamic = "force-dynamic";

type ListExportProps = {
  entity: string;         // z.B. "usecases"
  currentSearch?: string; // optional: Filterstring, wenn du später Suche einbaust
};

// Kleiner Button-Block für PDF/CSV-Liste
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




export default async function UsecasesPage() {
  const usecases = await getUsecases();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">UseCases</h1>
          <p className="text-sm text-slate-400">
            Stammdaten der Optimierungs-UseCases inkl. Anzahl angebundener Devices.
          </p>
        </div>
        <div className="flex items-center gap-3">
    	 <span className="text-xs text-slate-400">
      	 {usecases.length} UseCase(s)
    	 </span>
    	 {/* Drucker für Listen-Report */}
    	 <ListExportButton entity="usecases" />
  	</div>
      </div>


      {/* Cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {usecases.map((u: any) => (
          <Card
            key={u.id}
            className="bg-slate-950 border border-slate-800 hover:bg-slate-900 transition-colors"
          >
            <CardContent className="p-4 space-y-3">
              {/* Kopfbereich: Kategorie, ID/Name, Badge, Device-Count */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-400">
                    [ {u.category} ]
                  </div>
                  <div className="text-xs text-slate-300">
                    <span className="font-mono">
                      Key: {u.id} 
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <Badge
                    variant="outline"
                    className="border-slate-600 text-slate-100 bg-slate-900"
                  >
                    {u.name}
                  </Badge>
                  <span className="text-[11px] text-slate-400">
                    {u.device_count} Device(s)
                  </span>
                </div>
              </div>

              {/* Beschreibung */}
              {u.description && (
                <div className="text-xs text-slate-300">
                  {u.description}
                </div>
              )}

              {/* Default Config */}
              {u.default_config && (
                <details className="mt-1 text-[11px] text-slate-300">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                    Default Config
                  </summary>
                  <pre className="mt-1 bg-slate-950 border border-slate-800 rounded p-2 max-h-40 overflow-auto text-[11px] leading-snug text-slate-200">
                    {JSON.stringify(u.default_config, null, 2)}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

