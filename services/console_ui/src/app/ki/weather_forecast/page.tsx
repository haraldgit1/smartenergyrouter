// app/ki/weather_forecast/page.tsx
import { getTiRexCharts } from "@/lib/api";
import { WeatherForecastCharts } from "@/components/ki/weather-forecast-charts";

export const dynamic = "force-dynamic";

export default async function WeatherForecastPage() {
  const historyHours = 48;
  const horizonHours = 48;
  const resolutionMinutes = 60;

  const data = await getTiRexCharts({
    series: "meter1:load_kw", // oder deine Standard-Serie
    historyHours,
    horizonHours,
    resolutionMinutes,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Wetter Forecast</h1>
          <p className="text-sm text-slate-400">
            Temperatur und Solarstrahlung – synchron zur TiRex-Last-/Preisansicht.
          </p>
        </div>
        <div className="text-xs text-slate-400 text-right">
          {historyHours}h Historie · {horizonHours}h Forecast ·{" "}
          {resolutionMinutes}min Raster
        </div>
      </div>

      <WeatherForecastCharts data={data} />
    </div>
  );
}

