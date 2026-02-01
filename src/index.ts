import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import rawBody from "fastify-raw-body";
import twilio from "twilio";
import { buildTwimlStreamResponse } from "./twilio/twiml.js";
import { registerTwilioStreamRoutes } from "./ws/twilioStream.js";
import { setLead } from "./agent/leadStore.js";
import type { LeadPayload } from "./agent/prompt.js";

const app = Fastify({ logger: true });

await app.register(websocket);
await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true
});

app.get("/health", async () => ({ ok: true }));

/**
 * Twilio hits /voice webhook when call connects.
 * We respond with TwiML to start Media Streams to our /ws/twilio endpoint.
 */
app.post("/voice", async (_req, reply) => {
  const publicBase = process.env.PUBLIC_BASE_URL!;
  const streamUrl = `${publicBase.replace(/^http/, "ws")}/ws/twilio`;

  const twiml = buildTwimlStreamResponse(streamUrl);
  reply.header("Content-Type", "text/xml").send(twiml);
});

/**
 * Demo: trigger outbound call via Twilio
 * Body: { to: "+91xxxxxxxxxx", lead: {...} }
 */
app.post<{ Body: { to: string; lead: LeadPayload } }>("/call", async (req, reply) => {
  const { to, lead } = req.body;

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  // Create the call and Twilio will hit our /voice webhook.
  const call = await client.calls.create({
    to,
    from: process.env.TWILIO_FROM_NUMBER!,
    url: `${process.env.PUBLIC_BASE_URL}/voice`,
    method: "POST"
  });

  // Store lead against CallSid so the WS handler can pick it up
  setLead(call.sid, lead);

  reply.send({ ok: true, callSid: call.sid });
});

await registerTwilioStreamRoutes(app);

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: "0.0.0.0" });
