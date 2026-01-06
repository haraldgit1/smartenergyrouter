// services/console_ui/src/app/api/ki/forecast/route.ts
import { NextResponse } from "next/server";

// Interne Basis-URL für dein Console-API (FastAPI Aggregator).
// Im Docker-Setup z.B. via Umgebungsvariable setzen:
//
// KI_INTERNAL_BASE_URL=http://console_api:8000
//
// Zum Testen auf dem Host: KI_INTERNAL_BASE_URL=http://localhost:8100
const KI_INTERNAL_BASE_URL =
  process.env.KI_INTERNAL_BASE_URL ?? "http://localhost:8100";

function toInt(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const series = searchParams.get("series");
    const history_hours = searchParams.get("history_hours") ?? "48";
    const horizon_hours = searchParams.get("horizon_hours") ?? "48";

    // neu: backend + step_minutes (mit robusten Defaults)
    const backend = searchParams.get("backend") ?? "tirex_v1";

    const requestedStep = toInt(searchParams.get("step_minutes"), 15);
    const effectiveStep = Math.max(15, requestedStep); // TiRex-Fix: min 15

    if (!series) {
      return NextResponse.json(
        { error: "Parameter 'series' ist erforderlich." },
        { status: 400 }
      );
    }

    const backendParams = new URLSearchParams({
      series,
      history_hours,
      horizon_hours,
      backend,
      step_minutes: String(effectiveStep),
    });

    const url = `${KI_INTERNAL_BASE_URL}/ki/forecast?${backendParams.toString()}`;

    const res = await fetch(url, {
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");

    // Wir geben den echten Status vom Backend weiter (422 bleibt 422).
    if (!res.ok) {
      console.error(
        `Fehler vom KI-Backend (${res.status}):`,
        text || "<kein Body>"
      );

      // falls Backend JSON liefert, versuchen wir es durchzureichen
      let backendBody: any = null;
      try {
        backendBody = text ? JSON.parse(text) : null;
      } catch {
        backendBody = text || null;
      }

      return NextResponse.json(
        {
          error: "Fehler vom KI-Backend",
          status: res.status,
          backendBody,
          meta: {
            backend,
            requested_step_minutes: requestedStep,
            effective_step_minutes: effectiveStep,
          },
        },
        { status: res.status }
      );
    }

    // OK: Backend JSON
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // sollte praktisch nie passieren, aber wir bleiben robust
      return NextResponse.json(
        {
          error: "KI-Backend lieferte kein JSON",
          backendBody: text || null,
        },
        { status: 502 }
      );
    }

    const resp = NextResponse.json(data);
    // Debug-Header, damit du in DevTools siehst, was wirklich rausging:
    resp.headers.set("x-step-minutes-requested", String(requestedStep));
    resp.headers.set("x-step-minutes-effective", String(effectiveStep));
    resp.headers.set("x-backend-requested", backend);

    return resp;
  } catch (e: any) {
    console.error("Interner Fehler in /api/ki/forecast:", e);
    return NextResponse.json(
      { error: "Interner Fehler in /api/ki/forecast", detail: String(e) },
      { status: 500 }
    );
  }
}

