// src/app/api/flows/route.ts
import { NextResponse } from "next/server";
import { getFlows } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hours = Number(searchParams.get("hours") ?? "72");

  const flows = await getFlows(hours);
  return Response.json(flows);
}
