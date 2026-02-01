import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { OpenAIRealtimeClient } from "../realtime/openaiRealtime.js";
import { buildSystemPrompt } from "../agent/prompt.js";
import { getLead } from "../agent/leadStore.js";

type TwilioMediaMsg =
  | { event: "start"; start: { callSid: string } }
  | { event: "media"; media: { payload: string } }
  | { event: "stop" }
  | any;

export async function registerTwilioStreamRoutes(app: FastifyInstance) {
  // Twilio connects to this WSS endpoint using <Stream url="wss://.../ws/twilio" />
  app.get("/ws/twilio", { websocket: true }, (connection, _req) => {
    const socket = connection.socket as unknown as WebSocket;

    let callSid = "";
    let rt: OpenAIRealtimeClient | null = null;

    // Simple "silence detection" timer: respond after ~700ms of no media frames
    let silenceTimer: NodeJS.Timeout | null = null;
    const SILENCE_MS = 700;

    function armSilenceTimer() {
      if (!rt) return;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        rt?.commitAndRespond();
      }, SILENCE_MS);
    }

    socket.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as TwilioMediaMsg;

      if (msg.event === "start") {
        callSid = msg.start.callSid;

        const lead =
          getLead(callSid) ?? ({
            customer_name: "Customer",
            loan_number: "NA",
            repayment_amount_inr: 0,
            due_date_iso: "NA",
            company_name: "Company"
          } as const);

        const systemPrompt = buildSystemPrompt(lead);

        rt = new OpenAIRealtimeClient(
          {
            apiKey: process.env.OPENAI_API_KEY!,
            model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime",
            systemPrompt
          },
          {
            onAudioDelta: (ulawB64) => {
              // Send assistant audio back to Twilio (payload must be base64 g711_ulaw)
              socket.send(
                JSON.stringify({
                  event: "media",
                  media: { payload: ulawB64 }
                })
              );
            },
            onError: (e) => console.error("Realtime error:", e)
          }
        );

        rt.connect();
        return;
      }

      if (msg.event === "media") {
        if (!rt) return;

        // Caller audio from Twilio (base64 g711_ulaw)
        rt.appendAudio(msg.media.payload);

        // Reset silence timer whenever new audio arrives
        armSilenceTimer();
        return;
      }

      if (msg.event === "stop") {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = null;
        rt?.close();
        rt = null;
        return;
      }
    });

    socket.on("close", () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
      rt?.close();
      rt = null;
    });
  });
}
