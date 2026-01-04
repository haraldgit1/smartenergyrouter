"use client";

import { useEffect, useState, useRef } from "react";
import EventLine from "./event-line";
import EventFilterBar from "./event-filter-bar";
import LiveIndicator from "./live-indicator";

export default function EventStreamConsole() {
  const [events, setEvents] = useState([]);
  const [isLive, setIsLive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const evtSource = new EventSource("/api/events/live");
    setIsLive(true);

    evtSource.onmessage = (e) => {
      const payload = JSON.parse(e.data);
      setEvents((prev) => [...prev, payload]);
    };

    evtSource.onerror = () => {
      setIsLive(false);
    };

    return () => evtSource.close();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [events]);

  return (
    <div className="border rounded p-4 space-y-4">
      <div className="flex items-center justify-between">
        <LiveIndicator live={isLive} />
        <EventFilterBar />
      </div>

      <div
        ref={scrollRef}
        className="h-[600px] overflow-y-auto bg-black text-green-300 font-mono p-2 rounded"
      >
        {events.map((e, i) => (
          <EventLine key={i} e={e} />
        ))}
      </div>
    </div>
  );
}

