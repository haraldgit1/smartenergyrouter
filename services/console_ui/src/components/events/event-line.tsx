// components/events/event-line.tsx
import { EventRecord } from "./types";

type Props = {
  e: EventRecord;
};

const levelStyle: Record<string, string> = {
  DEBUG: "text-slate-500",
  INFO: "text-green-300",
  WARN: "text-yellow-300",
  ERROR: "text-red-300",
};

const lineBg: Record<string, string> = {
  WARN: "bg-yellow-950/40 border-l border-yellow-500/60",
  ERROR: "bg-red-950/40 border-l border-red-500/70",
};

export default function EventLine({ e }: Props) {
  const level = (e.level || "INFO").toUpperCase();
  const textClass = levelStyle[level] || "text-green-300";
  const bgClass = lineBg[level] || "";

  const ts = e.ts
    ? new Date(e.ts).toISOString().replace("T", " ").replace("Z", "")
    : "";

  const tags = [
    e.service && `svc=${e.service}`,
    e.flow_id && `flow=${e.flow_id}`,
    e.device_id && `dev=${e.device_id}`,
  ].filter(Boolean);

  return (
    <div
      className={`whitespace-pre text-xs px-2 py-1 rounded ${bgClass} ${textClass}`}
    >
      [{ts}] {level.padEnd(5, " ")}{" "}
      {tags.length > 0 ? `[${tags.join(" ")}] ` : ""}
      {e.msg ?? JSON.stringify(e.payload ?? {})}
    </div>
  );
}

