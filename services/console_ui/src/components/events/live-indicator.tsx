// components/events/live-indicator.tsx
type Props = {
  live: boolean;
};

export default function LiveIndicator({ live }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`w-2 h-2 rounded-full ${
          live ? "bg-green-400 animate-pulse" : "bg-slate-500"
        }`}
      />
      <span className="uppercase tracking-wide">
        {live ? "LIVE" : "HISTORY"}
      </span>
    </div>
  );
}

