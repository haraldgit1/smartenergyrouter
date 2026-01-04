// src/app/optimizer/page.tsx
import { getDevices, getUsecases } from "@/lib/api";
import OptimizerPageClient from "./OptimizerPageClient";

export const dynamic = "force-dynamic";

export default async function OptimizerPage() {
  const devices = await getDevices();
  const usecases = await getUsecases();

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Optimizer Cockpit</h1>
          <p className="text-sm text-slate-400">
            Fahrpläne pro Device/UseCase berechnen – inklusive Kosten- und CO₂-Einsparung.
          </p>
        </div>
      </div>

      <OptimizerPageClient devices={devices} usecases={usecases} />
    </div>
  );
}

