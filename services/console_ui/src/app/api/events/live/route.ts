// src/app/api/events/live/route.ts

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const sendHeartbeat = () => {
        const ev = {
          ts: new Date().toISOString(),
          service_name: "system",
          severity: "debug",
          event_type: "heartbeat",
          message: "live-endpoint-heartbeat",
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(ev)}\n\n`)
        );
      };

      // direkt beim Verbinden einen ersten Event schicken
      sendHeartbeat();

      // alle 30s ein Heartbeat-Event
      interval = setInterval(sendHeartbeat, 30000);
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

