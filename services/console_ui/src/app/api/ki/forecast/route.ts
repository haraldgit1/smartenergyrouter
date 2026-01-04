// src/app/api/ki/forecast/route.ts
import { NextResponse } from "next/server";

// Interne Basis-URL für deinen TiRex-/FastAPI-Service.
// Im Docker-Setup z.B. via Umgebungsvariable setzen:
//
// KI_INTERNAL_BASE_URL=http://predictor_tirex:8100
//
// Zum Testen auf dem Host: KI_INTERNAL_BASE_URL=http://localhost:8100
const KI_INTERNAL_BASE_URL =
  process.env.KI_INTERNAL_BASE_URL ?? "http://localhost:8100";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const series = searchParams.get("series");
    const history_hours = searchParams.get("history_hours") ?? "48";
    const horizon_hours = searchParams.get("horizon_hours") ?? "48";

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
    });

    const url = `${KI_INTERNAL_BASE_URL}/ki/forecast?${backendParams.toString()}`;

    const res = await fetch(url, {
      // wichtig: serverseitiger Fetch, kein CORS-Problem
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `Fehler vom KI-Backend (${res.status}):`,
        text || "<kein Body>"
      );

      return NextResponse.json(
        {
          error: "Fehler vom KI-Backend",
          status: res.status,
          backendBody: text || null,
        },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("Interner Fehler in /api/ki/forecast:", e);
    return NextResponse.json(
      { error: "Interner Fehler in /api/ki/forecast", detail: String(e) },
      { status: 500 }
    );
  }
}

