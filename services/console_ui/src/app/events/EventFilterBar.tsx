export default function EventFilterBar() {
  return (
    <div className="flex gap-3 text-xs text-slate-300">
      <button className="px-2 py-1 rounded bg-slate-800">All</button>
      <button className="px-2 py-1 rounded bg-slate-800">Optimizer</button>
      <button className="px-2 py-1 rounded bg-slate-800">Predictor</button>
      <button className="px-2 py-1 rounded bg-slate-800">Router</button>
    </div>
  );
}

