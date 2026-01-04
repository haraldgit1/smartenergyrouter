export default function EventLine({ e }) {
  return (
    <div className="whitespace-pre">
      [{e.ts}] {e.service}:{e.type} → {JSON.stringify(e.data)}
    </div>
  );
}

