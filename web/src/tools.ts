import { FunctionDeclaration, Tool, Type } from "@google/genai";
import { startBatch } from "./components/rail/Rail";
import { USE_MOCK, mockFetchBrief } from "./components/rail/mockServer";
import type { FeedEvent, BriefData } from "./components/rail/types";
import { logEvent } from "./state/events";

// ---------------------------------------------------------------- Constants & Env

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:8000";

// ---------------------------------------------------------------- Module-level State

let getLatestKeyframeB64: (() => string | null) = () => null;
let chosenVariantDescription = "replace the armchair with a rattan chair, warm minimal style";
let chosenVariantObjects: string[] = ["rattan armchair", "curtains", "plants"];
let firstEventTime: number | null = null;

// ---------------------------------------------------------------- Setup Helpers

export function registerKeyframeGrabber(grabber: () => string | null) {
  getLatestKeyframeB64 = grabber;
}

export function setChosenVariantDetails(description: string, objects: string[]) {
  chosenVariantDescription = description;
  chosenVariantObjects = objects;
}

export function getElapsedTime(): number {
  if (firstEventTime === null) {
    firstEventTime = Date.now();
  }
  return Date.now() - firstEventTime;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export function logFeedEvent(event: DistributiveOmit<FeedEvent, "t">) {
  const t = getElapsedTime();
  const fullEvent = { ...event, t } as FeedEvent;
  
  try {
    logEvent(fullEvent);
  } catch (err) {
    console.warn("[tools] logEvent failed:", err);
  }
}

// ---------------------------------------------------------------- Tool Declarations

export const generateVariantsDeclaration: FunctionDeclaration = {
  name: "generate_variants",
  description: "Generate 4 redesign variants of what the camera currently sees. Call this whenever the conversation has produced a concrete design direction — do not ask permission, just call it.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      description: {
        type: Type.STRING,
        description: "One-sentence design direction, e.g. 'replace the armchair with a rattan chair, warm neutral palette, keep everything else identical'"
      }
    },
    required: ["description"]
  }
};

export const playSceneDeclaration: FunctionDeclaration = {
  name: "play_scene",
  description: "Play a cinematic video of the currently selected design. Call when the user asks to see the room 'in the evening', 'at golden hour', 'in the monsoon', or 'living in it'.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      scene: {
        type: Type.STRING,
        description: "The scene/time-of-day cinematic overlay to display",
        enum: ["evening", "monsoon"]
      }
    },
    required: ["scene"]
  }
};

export const compileBriefDeclaration: FunctionDeclaration = {
  name: "compile_brief",
  description: "Compile the architect brief for the current design: itemized rupee budget with vendor links and the legal/society-approval checklist. Call when the user asks to 'send this to my architect', asks about total cost, or asks what approvals they need.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: []
  }
};

// Complete session config tools array
export const tools: Tool[] = [
  { googleSearch: {} },
  {
    functionDeclarations: [
      generateVariantsDeclaration,
      playSceneDeclaration,
      compileBriefDeclaration
    ]
  }
];

// ---------------------------------------------------------------- Tool Dispatcher

export async function dispatchToolCall(
  client: any,
  fc: { id: string; name: string; args: any },
  callbacks: {
    onShowBrief: (visible: boolean) => void;
    onSetBrief: (brief: BriefData | null) => void;
    onPlayVideo: (scene: "evening" | "monsoon") => void;
  }
) {
  const { id, name, args } = fc;

  // Log the tool call immediately to feed the brain-feed store
  logFeedEvent({
    kind: "tool_call",
    name,
    args: args || {},
  });

  if (name === "generate_variants") {
    const description = args.description || "";
    
    // ⚠ CRITICAL: Send Tool Response IMMEDIATELY so the conversational model never stalls
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: `Generating 4 design options for "${description}" now. They'll stream onto your bottom rail shortly. Let's keep talking!`,
          },
        },
      ],
    });

    // Run the actual image-edit pipeline asynchronously
    (async () => {
      const t0 = Date.now();
      try {
        if (USE_MOCK) {
          const mockBatchId = `mock-${Date.now()}`;
          console.log("[tools] USE_MOCK is true. Spawning mock batch:", mockBatchId);
          startBatch(mockBatchId);
          
          // Log complete images event in 6 seconds (to mirror the mock fill duration)
          setTimeout(() => {
            logFeedEvent({
              kind: "images",
              batchId: mockBatchId,
              done: 4,
              ms: Date.now() - t0,
            });
          }, 6000);
        } else {
          // DREAM mode: no camera feed -> keyframe_b64 null -> server does pure
          // text-to-image generation (docs/PIVOT-DUALMODE.md). Never block on a missing frame.
          const keyframe_b64 = getLatestKeyframeB64();
          if (!keyframe_b64) {
            console.log("[tools] No camera keyframe — DREAM mode generation.");
          }

          console.log("[tools] Posting variants fetch to:", `${SERVER_URL}/variants`);
          const res = await fetch(`${SERVER_URL}/variants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description, keyframe_b64 }),
          });

          if (!res.ok) {
            throw new Error(`HTTP error ${res.status}`);
          }

          const { batch_id } = await res.json();
          console.log("[tools] Batch initiated successfully:", batch_id);
          startBatch(batch_id);

          // Track progressive image status polling to fire the logger's "images" event on finality
          const pollStart = Date.now();
          const intervalId = setInterval(async () => {
            try {
              const pollRes = await fetch(`${SERVER_URL}/variants/${batch_id}`);
              if (pollRes.ok) {
                const pollData = await pollRes.json();
                const images = pollData.images || [];
                const doneCount = images.filter((img: any) => img.status === "done").length;
                const pendingCount = images.filter((img: any) => img.status === "pending").length;

                // Stop polling if complete, or if we hit a 45s safety timeout
                if (pendingCount === 0 || Date.now() - pollStart > 45000) {
                  clearInterval(intervalId);
                  logFeedEvent({
                    kind: "images",
                    batchId: batch_id,
                    done: doneCount,
                    ms: Date.now() - t0,
                  });
                }
              }
            } catch (err) {
              console.error("[tools] Polling error in background logging:", err);
            }
          }, 2000);
        }
      } catch (err) {
        console.error("[tools] generate_variants async task failed:", err);
      }
    })();

  } else if (name === "play_scene") {
    const scene = args.scene as "evening" | "monsoon";

    // Immediate confirmation reply
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: `Let me show you how this looks in the ${scene}... I'm loading the cinematic view now.`,
          },
        },
      ],
    });

    // Fire video trigger overlay
    callbacks.onPlayVideo(scene);

  } else if (name === "compile_brief") {
    // Immediate confirmation reply
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: "I am preparing the brief for your architect now. One moment.",
          },
        },
      ],
    });

    // Compile architect brief asynchronously
    (async () => {
      try {
        callbacks.onShowBrief(true);
        callbacks.onSetBrief(null); // Triggers "Compiling brief…" skeleton state

        let brief: BriefData;
        if (USE_MOCK) {
          brief = await mockFetchBrief();
        } else {
          console.log("[tools] Fetching brief from server for:", chosenVariantDescription);
          const res = await fetch(`${SERVER_URL}/brief`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: chosenVariantDescription,
              objects: chosenVariantObjects,
            }),
          });
          
          if (!res.ok) {
            throw new Error(`HTTP error ${res.status}`);
          }
          brief = await res.json();
        }
        callbacks.onSetBrief(brief);
      } catch (err) {
        console.error("[tools] compile_brief async task failed:", err);
      }
    })();
  }
}
