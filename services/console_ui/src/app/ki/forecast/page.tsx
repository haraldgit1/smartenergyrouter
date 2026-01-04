// src/app/ki/forecast/page.tsx
import KIForecastClient from "./KIForecastClient";

export const dynamic = "force-dynamic";

const SERIES_OPTIONS = [
  { value: "meter1:load_kw", label: "meter1:load_kw (Verbrauch)" },
  { value: "boiler1:load_kw", label: "boiler1:load_kw (Boiler)" },
];

export default function KIForecastPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">KI-Forecast (TiRex / xLSTM)</h1>
          <p className="text-sm text-slate-400">
            Historie und Vorhersage für ausgewählte Zeitreihen
            (History + Forecast als Linien-Chart).
          </p>
        </div>
      </div>

      <KIForecastClient
        seriesOptions={SERIES_OPTIONS}
        defaultSeries="meter1:load_kw"
        defaultHistoryHours={48}
        defaultHorizonHours={48}
      />
    </div>
  );
}

