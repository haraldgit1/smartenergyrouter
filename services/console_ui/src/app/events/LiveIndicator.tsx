export default function LiveIndicator({ live }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-2 h-2 rounded-full ${
          live ? "bg-green-400 animate-pulse" : "bg-red-500"
        }`}
      />
      {live ? "live" : "offline"}
    </div>
  );
}

