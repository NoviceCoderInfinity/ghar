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

import { useCallback, useEffect, useRef, useState } from "react";
import "./App.scss";
import { LiveAPIProvider, useLiveAPIContext } from "./contexts/LiveAPIContext";
import SidePanel from "./components/side-panel/SidePanel";
import ControlTray from "./components/control-tray/ControlTray";
import cn from "classnames";
import { LiveClientOptions } from "./types";
import { Modality } from "@google/genai";

// Ghar custom imports
import Rail, { setOnVariantChosen } from "./components/rail/Rail";
import BriefScreen from "./components/rail/BriefScreen";
import type { BriefData } from "./components/rail/types";
import { tools, dispatchToolCall, registerKeyframeGrabber, setChosenVariantDetails } from "./tools";
import BrainFeed from "./components/brainfeed/BrainFeed";
import { buildSessionContext } from "./state/sessionContext";

const API_KEY = process.env.REACT_APP_GEMINI_API_KEY as string;
if (typeof API_KEY !== "string") {
  throw new Error("set REACT_APP_GEMINI_API_KEY in .env");
}

const apiOptions: LiveClientOptions = {
  apiKey: API_KEY,
};

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:8000";

// Fallback starting draft of the Indian designer persona (matches docs/PROMPTS.md §1)
const BUILT_IN_PERSONA = `You are Ghar, a warm, sharp interior designer on a live video call, looking at the user's room through their phone camera. You are Indian, based in Bengaluru, and you design for Indian homes.

VOICE
- Speak like a designer friend, not an assistant. 1–2 sentences per turn unless asked for more.
- Never say "As an AI" or describe your own capabilities. Never ask "How can I help you today?"
- If interrupted, stop immediately and respond to the new direction without recapping.

BEHAVIOR
- You SEE continuously. Comment proactively on things the user hasn't mentioned — light direction, window glare, clutter, color clashes, dead corners. One observation at a time, only when relevant.
- When the conversation produces a concrete design direction, CALL generate_variants immediately. Do not ask "shall I generate options?" — you are the designer; show, don't ask. While variants generate, keep talking naturally about the space.
- When the user wants to "see it in the evening / monsoon / lived-in", CALL play_scene.
- If the user states a constraint (kids, pets, budget, rent), respect it in every later suggestion and briefly acknowledge it once.

INDIA AWARENESS (use naturally, never as a lecture)
- Vaastu: mention gently when relevant (mirror facing bed, entrance direction, kitchen corner) — frame as "your family might prefer", never as superstition or rule.
- Budgets in rupees, realistic Indian prices. Materials: cane, jute, sheesham, teak (note teak's cost), Chettinad tiles, block-print textiles. Climate: monsoon humidity, dust, ceiling fans exist.
- If the user switches to Hindi or Kannada, follow them in that language naturally.

SAFETY RAILS
- One design direction at a time. Never promise features the app doesn't have.
- If the camera shows a person, compliment the room, not the person.`;

function GharConsole({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const { client, setConfig, setModel, connected, connect, disconnect } = useLiveAPIContext();
  const [systemInstruction, setSystemInstruction] = useState(BUILT_IN_PERSONA);

  // Overlays & Screens state
  const [showBrief, setShowBrief] = useState(false);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [activeVideoScene, setActiveVideoScene] = useState<"evening" | "monsoon" | null>(null);

  // 2-minute session countdown state
  const [timeLeft, setTimeLeft] = useState(120);

  // 1. Load custom prompts/persona.md dynamically if compiled by Agent A3, then append the
  // client-built SESSION CONTEXT block (T4, docs/PROMPTS.md §1b) on both the fetched-persona
  // and built-in-fallback paths, before the Live session config is built (effect #2).
  useEffect(() => {
    let cancelled = false;

    const appendSessionContext = async (personaText: string) => {
      try {
        const context = await buildSessionContext();
        if (!cancelled) {
          setSystemInstruction(`${personaText}\n\n${context}`);
        }
      } catch (err) {
        console.log("[App] Failed to build session context, using persona alone.", err);
      }
    };

    fetch("/prompts/persona.md")
      .then((res) => {
        if (res.ok) return res.text();
        throw new Error("Persona not found");
      })
      .then((text) => {
        if (text && text.trim().length > 10) {
          console.log("[App] Dynamically loaded custom persona system instruction.");
          return appendSessionContext(text);
        }
        return appendSessionContext(BUILT_IN_PERSONA);
      })
      .catch(() => {
        console.log("[App] Using built-in fallback system instruction.");
        return appendSessionContext(BUILT_IN_PERSONA);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Configure Live API model, system instructions, and tool declarations
  useEffect(() => {
    setModel("models/gemini-3.1-flash-live-preview");
    setConfig({
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }, // Warm speaking tone
      },
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      tools: tools,
    });
  }, [setConfig, setModel, systemInstruction]);

  // 3. Register Keyframe Grabber
  useEffect(() => {
    registerKeyframeGrabber(() => {
      if (!videoRef.current) return null;
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        if (dataUrl.includes(",")) {
          return dataUrl.split(",")[1];
        }
        return dataUrl;
      }
      return null;
    });
    return () => {
      registerKeyframeGrabber(() => null);
    };
  }, [videoRef]);

  // 4. Listen for tool call dispatch events
  useEffect(() => {
    const onToolCall = (toolCall: any) => {
      console.log("[App] Tool call received:", toolCall);
      if (!toolCall.functionCalls) return;

      for (const fc of toolCall.functionCalls) {
        dispatchToolCall(client, fc, {
          onShowBrief: (visible) => setShowBrief(visible),
          onSetBrief: (b) => setBrief(b),
          onPlayVideo: (scene) => {
            setActiveVideoScene(scene);
          },
        });
      }
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client]);

  // 5. Connect variant selection from bottom Rail to Live Session
  useEffect(() => {
    setOnVariantChosen((url, slot) => {
      if (!url) return;
      console.log("[App] Variant chosen:", url, "at slot:", slot + 1);
      
      // Feedback user choice to the live model to anchor suggestions
      client.send([{
        text: `[User tapped and enlarged Variant ${slot + 1} from the bottom rail (${url}). Please center your suggestions around this design direction and style.]`
      }]);

      // Stash design information dynamically based on which variant slot is chosen
      let description = "contemporary style redesign";
      let objects = ["armchair", "curtains"];
      
      if (slot === 0) {
        description = "redesign in a warm minimal style with natural materials";
        objects = ["warm minimalist wooden armchair", "natural jute rug", "linen curtains", "subtle floor lamp"];
      } else if (slot === 1) {
        description = "redesign in a contemporary Indian style with cane and block-print textiles";
        objects = ["cane armchair", "block-print curtains", "terracotta pots", "brass lamp"];
      } else if (slot === 2) {
        description = "redesign in a bold color-forward style";
        objects = ["teal accent armchair", "vibrant ochre curtains", "colorful abstract rug", "potted monstera"];
      } else if (slot === 3) {
        description = "redesign in a budget-friendly style using affordable materials";
        objects = ["affordable fabric lounge chair", "bamboo blinds", "cotton rug", "hanging planters"];
      }

      setChosenVariantDetails(description, objects);
    });

    return () => {
      setOnVariantChosen(null);
    };
  }, [client]);

  // 6. 2-minute hard cap countdown timer
  useEffect(() => {
    let intervalId: any = null;
    if (connected) {
      setTimeLeft(120);
      intervalId = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(intervalId);
            disconnect();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setTimeLeft(120);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [connected, disconnect]);

  // 7. Reconnect handler (<10 seconds teardown & setup)
  const handleReconnect = useCallback(async () => {
    console.log("[App] One-tap Reconnecting session...");
    await disconnect();
    setTimeout(async () => {
      await connect();
    }, 300);
  }, [connect, disconnect]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      {/* 2-minute Countdown and Reconnect Overlay */}
      {connected && (
        <div className="ghar-top-bar">
          <span>Session Timer: </span>
          <span className={cn("timer", { warning: timeLeft < 30 })}>
            {formatTime(timeLeft)}
          </span>
          <button className="reconnect-btn" onClick={handleReconnect}>
            🔄 Reconnect
          </button>
        </div>
      )}

      {/* Fullscreen dismissible video scene overlay */}
      {activeVideoScene && (
        <div className="ghar-video-overlay" onClick={() => setActiveVideoScene(null)}>
          <div className="ghar-video-container" onClick={(e) => e.stopPropagation()}>
            <video
              src={`/clips/${activeVideoScene}.mp4`}
              autoPlay
              controls
              onEnded={() => setActiveVideoScene(null)}
              className="ghar-video-player"
            />
            <div className="ghar-video-caption">
              generated with Omni Flash earlier this session
            </div>
            <button className="ghar-video-close" onClick={() => setActiveVideoScene(null)}>
              ✕ Close
            </button>
          </div>
        </div>
      )}

      {/* Progressive Variant Bottom Rail strip */}
      <Rail serverUrl={SERVER_URL} />

      {/* Architect Brief Screen */}
      <BriefScreen brief={brief} visible={showBrief} onClose={() => setShowBrief(false)} />
    </>
  );
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);

  return (
    <div className="App">
      <LiveAPIProvider options={apiOptions}>
        <div className="streaming-console">
          <SidePanel />
          <main>
            <div className="main-app-area">
              <GharConsole videoRef={videoRef} />
              <video
                className={cn("stream", {
                  hidden: !videoRef.current || !videoStream,
                })}
                ref={videoRef}
                autoPlay
                playsInline
              />
            </div>

            <ControlTray
              videoRef={videoRef}
              supportsVideo={true}
              onVideoStreamChange={setVideoStream}
              enableEditingSettings={true}
            >
              {/* Custom buttons can be mapped here */}
            </ControlTray>
          </main>
          <BrainFeed />
        </div>
      </LiveAPIProvider>
    </div>
  );
}

export default App;
