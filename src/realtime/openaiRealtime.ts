import WebSocket from "ws";

export type RealtimeClientOpts = {
  apiKey: string;
  model: string;
  systemPrompt: string;
};

export type RealtimeHandlers = {
  onAudioDelta?: (ulawBase64: string) => void;
  onTextDelta?: (text: string) => void;
  onError?: (err: unknown) => void;
  onDebug?: (msg: any) => void;
};

export class OpenAIRealtimeClient {
  private ws: WebSocket | null = null;

  constructor(private opts: RealtimeClientOpts, private handlers: RealtimeHandlers) {}

  connect() {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.opts.model)}`;

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    this.ws.on("open", () => {
      // Configure session to use G.711 u-law end-to-end for easiest Twilio integration
      this.send({
        type: "session.update",
        session: {
          instructions: this.opts.systemPrompt,
          modalities: ["audio", "text"],
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw"
        }
      });

      // Proactive greeting from the agent
      this.send({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions:
            "Start the call now. First confirm you are speaking to the correct customer by name. Keep it short."
        }
      });
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handlers.onDebug?.(msg);

        // Assistant audio (base64) in the configured output format (g711_ulaw)
        if (msg.type === "response.audio.delta" && msg.delta) {
          this.handlers.onAudioDelta?.(msg.delta);
        }

        // Optional text deltas (debug / analytics)
        if (msg.type === "response.output_text.delta" && msg.delta) {
          this.handlers.onTextDelta?.(msg.delta);
        }

        if (msg.type === "error") {
          this.handlers.onError?.(msg);
        }
      } catch (e) {
        this.handlers.onError?.(e);
      }
    });

    this.ws.on("error", (err) => this.handlers.onError?.(err));
    this.ws.on("close", () => {
      this.ws = null;
    });
  }

  /**
   * Append caller audio chunk (g711_ulaw base64) into Realtime input buffer.
   * Commit + create a response should be triggered by VAD/silence (handled by WS bridge).
   */
  appendAudio(ulawBase64: string) {
    this.send({ type: "input_audio_buffer.append", audio: ulawBase64 });
  }

  /**
   * Commit the audio buffer and ask the model to respond.
   */
  commitAndRespond() {
    this.send({ type: "input_audio_buffer.commit" });
    this.send({
      type: "response.create",
      response: { modalities: ["audio", "text"] }
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }

  private send(obj: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }
}
