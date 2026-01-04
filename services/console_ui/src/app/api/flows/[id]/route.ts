// src/app/api/flows/[id]/route.ts
import { NextResponse } from "next/server";
import { getFlowDetail } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // params-Promise auflösen (Next.js 16)
  const { id } = await params;
  const decodedId = decodeURIComponent(id);

  try {
    const detail = await getFlowDetail(decodedId);
    return NextResponse.json(detail);
  } catch (err: any) {
    console.error("Error in /api/flows/[id]:", err);
    return new NextResponse("Not found", { status: 404 });
  }
}

