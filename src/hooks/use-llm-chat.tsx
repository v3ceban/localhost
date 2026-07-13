"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Engine,
  type Conversation,
  type Message as LlmMessage,
} from "@litert-lm/core";
import { MODELS, type Model } from "@/lib/registry";
import { getModelFile } from "@/lib/opfs-cache";
import { ensureLiteRtLm, hardResetLiteRtLm } from "@/lib/litert";
import { useModelCache } from "@/hooks/use-model-cache";

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  error: string | null;
};

const LlmChatContext = React.createContext<{
  engineStatus: EngineStatus;
  engineError: string | null;
  messages: ChatMessage[];
  isGenerating: boolean;
  send: (text: string) => void;
  restart: () => void;
} | null>(null);

type EngineHandles = {
  engine: Engine;
  conversation: Conversation;
};

type LoadOutcome = {
  model: Model;
  status: "ready" | "error";
  error: string | null;
};

// How long runtime cleanup may take before the engine is declared wedged
// (google-ai-edge/LiteRT-LM#2422) and the wasm runtime is fully reset.
const WEDGE_TIMEOUT_MS = 500;

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

function extractText(message: LlmMessage): string {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export function LlmChatProvider({ children }: { children: React.ReactNode }) {
  const { models, activeModel, remove } = useModelCache();
  const [loadOutcome, setLoadOutcome] = React.useState<LoadOutcome | null>(
    null,
  );
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = React.useState(false);

  const isModelCached =
    activeModel != null && models[activeModel].status === "cached";
  const engineStatus: EngineStatus =
    !activeModel || !isModelCached
      ? "idle"
      : loadOutcome?.model === activeModel
        ? loadOutcome.status
        : "loading";
  const engineError =
    engineStatus === "error" ? (loadOutcome?.error ?? null) : null;

  const handlesRef = React.useRef<EngineHandles | null>(null);
  const readerRef =
    React.useRef<ReadableStreamDefaultReader<LlmMessage> | null>(null);
  const generationRef = React.useRef<Promise<void>>(Promise.resolve());
  const generationTokenRef = React.useRef(0);
  const loadTokenRef = React.useRef(0);
  const engineOpsRef = React.useRef<Promise<void>>(Promise.resolve());
  const messageIdRef = React.useRef(0);

  // Only used when the engine goes away mid-generation (model switch or
  // unload); user-facing stop is intentionally unsupported because
  // cancellation wedges the runtime (google-ai-edge/LiteRT-LM#2422).
  function cancelGeneration() {
    generationTokenRef.current++;
    setIsGenerating(false);
    const reader = readerRef.current;
    readerRef.current = null;
    if (!reader) return;
    console.info("Cancelling generation");
    void reader.cancel().catch(() => {});
  }

  async function teardownEngine() {
    const handles = handlesRef.current;
    handlesRef.current = null;
    cancelGeneration();
    await generationRef.current;
    if (!handles) return;
    const result = await Promise.race([
      (async () => {
        await handles.conversation.delete();
        await handles.engine.delete();
      })().catch((err: unknown) => {
        console.error("Failed to delete the engine:", err);
      }),
      timeout(WEDGE_TIMEOUT_MS),
    ]);
    if (result === "timeout") {
      console.warn("Engine teardown timed out; resetting the wasm runtime");
      hardResetLiteRtLm();
    }
  }

  function enqueueEngineOp(op: () => Promise<void>) {
    engineOpsRef.current = engineOpsRef.current.then(op);
  }

  const loadEngine = React.useEffectEvent(
    (model: Model | null, isCached: boolean) => {
      const token = ++loadTokenRef.current;

      enqueueEngineOp(async () => {
        await teardownEngine();
        if (token !== loadTokenRef.current) return;
        setMessages([]);
        setIsGenerating(false);
        setLoadOutcome(null);
        if (!model || !isCached) return;
        try {
          const file = await getModelFile(model);
          if (!file) {
            remove(model);
            throw new Error(
              "The cached model file was missing or corrupted and has been removed. Download it again to use this model.",
            );
          }
          await ensureLiteRtLm();
          if (token !== loadTokenRef.current) return;
          const engine = await Engine.create({ model: file });
          let conversation: Conversation;
          try {
            conversation = await engine.createConversation();
          } catch (err) {
            await engine.delete().catch(() => {});
            throw err;
          }
          if (token !== loadTokenRef.current) {
            await conversation.delete().catch(() => {});
            await engine.delete().catch(() => {});
            return;
          }
          handlesRef.current = { engine, conversation };
          setLoadOutcome({ model, status: "ready", error: null });
          console.info(`${MODELS[model].label} is ready`);
        } catch (err) {
          console.error(`Failed to load ${MODELS[model].label}:`, err);
          if (token !== loadTokenRef.current) return;
          const message =
            err instanceof Error ? err.message : "Failed to load model";
          setLoadOutcome({ model, status: "error", error: message });
          toast.error(`${MODELS[model].label} failed to load`, {
            description: message,
          });
        }
      });
    },
  );

  React.useEffect(() => {
    loadEngine(activeModel, isModelCached);
  }, [activeModel, isModelCached]);

  async function runGeneration(
    handles: EngineHandles,
    text: string,
    assistantId: number,
    token: number,
  ) {
    function patchAssistant(patch: (message: ChatMessage) => ChatMessage) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId ? patch(message) : message,
        ),
      );
    }

    try {
      const reader = handles.conversation
        .sendMessageStreaming(text)
        .getReader();
      readerRef.current = reader;
      // controlled infinite loop
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = extractText(value);
        if (!delta) continue;
        patchAssistant((message) => ({
          ...message,
          content: message.content + delta,
        }));
      }
    } catch (err) {
      console.error("Generation failed:", err);
      if (token === generationTokenRef.current) {
        const message =
          err instanceof Error ? err.message : "Generation failed";
        patchAssistant((msg) => ({ ...msg, error: message }));
      }
    } finally {
      if (token === generationTokenRef.current) {
        readerRef.current = null;
        setIsGenerating(false);
      }
    }
  }

  function send(text: string) {
    const handles = handlesRef.current;
    const trimmed = text.trim();
    if (!handles || engineStatus !== "ready" || isGenerating || !trimmed) {
      return;
    }

    const token = ++generationTokenRef.current;
    const userId = messageIdRef.current++;
    const assistantId = messageIdRef.current++;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: trimmed, error: null },
      { id: assistantId, role: "assistant", content: "", error: null },
    ]);
    setIsGenerating(true);

    const previous = generationRef.current;
    generationRef.current = (async () => {
      await previous;
      if (token !== generationTokenRef.current) return;
      if (handlesRef.current !== handles) return;
      await runGeneration(handles, trimmed, assistantId, token);
    })();
  }

  function restart() {
    generationTokenRef.current++;
    setIsGenerating(false);
    setMessages([]);

    const handles = handlesRef.current;
    if (!handles) return;
    const previous = generationRef.current;
    generationRef.current = (async () => {
      await previous;
      if (handlesRef.current !== handles) return;
      try {
        const stale = handles.conversation;
        const conversation = await handles.engine.createConversation();
        if (handlesRef.current !== handles) {
          await conversation.delete().catch(() => {});
          return;
        }
        handles.conversation = conversation;
        await stale.delete();
        console.info("Conversation restarted");
      } catch (err) {
        console.error("Failed to restart the conversation:", err);
      }
    })();
  }

  return (
    <LlmChatContext.Provider
      value={{
        engineStatus,
        engineError,
        messages,
        isGenerating,
        send,
        restart,
      }}
    >
      {children}
    </LlmChatContext.Provider>
  );
}

export function useLlmChat() {
  const context = React.useContext(LlmChatContext);
  if (!context) {
    throw new Error("useLlmChat must be used within a LlmChatProvider");
  }
  return context;
}
