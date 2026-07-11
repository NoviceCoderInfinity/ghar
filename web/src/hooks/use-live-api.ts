/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GenAILiveClient } from "../lib/genai-live-client";
import { LiveClientOptions } from "../types";
import { AudioStreamer } from "../lib/audio-streamer";
import { audioContext } from "../lib/utils";
import VolMeterWorket from "../lib/worklets/vol-meter";
import { LiveConnectConfig } from "@google/genai";

export type UseLiveAPIResults = {
  client: GenAILiveClient;
  setConfig: (config: LiveConnectConfig) => void;
  config: LiveConnectConfig;
  model: string;
  setModel: (model: string) => void;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  volume: number;
};

export function useLiveAPI(options: LiveClientOptions): UseLiveAPIResults {
  const client = useMemo(() => new GenAILiveClient(options), [options]);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);

  const [model, setModel] = useState<string>("models/gemini-3.1-flash-live-preview");
  const [config, setConfig] = useState<LiveConnectConfig>({});
  const [connected, setConnected] = useState(false);
  const [volume, setVolume] = useState(0);
  // Distinguish user-initiated disconnects from server-side drops (session cap /
  // GoAway). Unexpected drops auto-reconnect so the demo never dies mid-sentence.
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const modelRef = useRef(model);
  const configRef = useRef(config);
  modelRef.current = model;
  configRef.current = config;

  // register audio for streaming server -> speakers
  useEffect(() => {
    if (!audioStreamerRef.current) {
      audioContext({ id: "audio-out" }).then((audioCtx: AudioContext) => {
        audioStreamerRef.current = new AudioStreamer(audioCtx);
        audioStreamerRef.current
          .addWorklet<any>("vumeter-out", VolMeterWorket, (ev: any) => {
            setVolume(ev.data.volume);
          })
          .then(() => {
            // Successfully added worklet
          });
      });
    }
  }, [audioStreamerRef]);

  useEffect(() => {
    const onOpen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    const onClose = () => {
      setConnected(false);
      if (intentionalCloseRef.current) return;
      // Server-side drop: heal it. Up to 3 rapid attempts, then give up quietly.
      if (reconnectAttemptsRef.current >= 3) {
        console.warn("[LiveAPI] Session dropped; auto-reconnect gave up after 3 tries.");
        return;
      }
      reconnectAttemptsRef.current += 1;
      const attempt = reconnectAttemptsRef.current;
      console.log(`[LiveAPI] Session dropped by server — auto-reconnecting (attempt ${attempt})...`);
      // Reconnects continue the same conversation (resumption handle below), so
      // ControlTray must not re-send the greeting kickoff.
      window.dispatchEvent(new Event("ghar-auto-reconnecting"));
      setTimeout(() => {
        // Attempt 1 resumes with the server's handle (full context survives).
        // If the handle is rejected the session closes again, and attempts 2–3
        // fall back to a fresh session rather than re-failing on the same handle.
        const handle = attempt === 1 ? client.resumptionHandle : null;
        const config: LiveConnectConfig = {
          ...configRef.current,
          sessionResumption: handle ? { handle } : {},
        };
        client
          .connect(modelRef.current, config)
          .catch((e) => console.warn("[LiveAPI] auto-reconnect failed:", e));
      }, 700);
    };

    const onError = (error: ErrorEvent) => {
      console.error("error", error);
    };

    const stopAudioStreamer = () => audioStreamerRef.current?.stop();

    // Local barge-in assist: server VAD can miss the user's voice under speaker
    // bleed. ControlTray dispatches "ghar-user-speaking" when the mic runs hot;
    // we cut Asha's audio on-device instantly so she always yields.
    const onUserSpeaking = () => stopAudioStreamer();
    window.addEventListener("ghar-user-speaking", onUserSpeaking);

    const onAudio = (data: ArrayBuffer) => {
      const streamer = audioStreamerRef.current;
      if (!streamer) return;
      // Self-heal a suspended output context WITHOUT calling streamer.resume():
      // resume() rewinds the scheduling cursor, so calling it per chunk makes
      // new buffers play on top of ones still playing (overlapping voices).
      if (streamer.context.state === "suspended") {
        streamer.context.resume().catch(() => {});
      }
      streamer.addPCM16(new Uint8Array(data));
    };

    client
      .on("error", onError)
      .on("open", onOpen)
      .on("close", onClose)
      .on("interrupted", stopAudioStreamer)
      .on("audio", onAudio);

    return () => {
      window.removeEventListener("ghar-user-speaking", onUserSpeaking);
      client
        .off("error", onError)
        .off("open", onOpen)
        .off("close", onClose)
        .off("interrupted", stopAudioStreamer)
        .off("audio", onAudio)
        .disconnect();
    };
  }, [client]);

  const connect = useCallback(async () => {
    if (!config) {
      throw new Error("config has not been set");
    }
    // Keep the intentional flag up through the whole connect: the close event
    // from the pre-connect teardown can arrive asynchronously, and must never
    // be mistaken for a server drop (which would trigger a rogue reconnect).
    intentionalCloseRef.current = true;
    client.disconnect();
    reconnectAttemptsRef.current = 0;
    try {
      await client.connect(model, config);
    } finally {
      intentionalCloseRef.current = false;
    }
  }, [client, config, model]);

  const disconnect = useCallback(async () => {
    intentionalCloseRef.current = true;
    client.disconnect();
    setConnected(false);
  }, [setConnected, client]);

  return {
    client,
    config,
    setConfig,
    model,
    setModel,
    connected,
    connect,
    disconnect,
    volume,
  };
}
