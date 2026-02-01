export function buildTwimlStreamResponse(streamWssUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello. Please hold for a moment.</Say>
  <Connect>
    <Stream url="${streamWssUrl}" />
  </Connect>
</Response>`;
}
