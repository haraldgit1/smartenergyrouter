// src/app/api/events/history/route.ts
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // Parameter sind für später schon vorbereitet, werden aber noch nicht genutzt
  const _limit = url.searchParams.get("limit") ?? "200";
  const _serviceName = url.searchParams.get("service_name");
  const _deviceId = url.searchParams.get("device_id");
  const _flowId = url.searchParams.get("flow_id");
  const _severity = url.searchParams.get("severity");

  // Aktuell: keine History vom Backend, UI arbeitet mit Demo-Events
  return Response.json([]);
}

