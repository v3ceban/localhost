"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Engine,
  type Conversation,
  type Message as LlmMessage,
  type Preface,
} from "@litert-lm/core";
import { MODELS, type Model } from "@/lib/registry";
import { getModelFile } from "@/lib/opfs-cache";
import { ensureLiteRtLm, hardResetLiteRtLm } from "@/lib/litert";
import { useModelCache } from "@/hooks/use-model-cache";

export type EngineStatus =
  "idle" | "loading" | "recovering" | "ready" | "error";

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
  stop: () => void;
  restart: () => void;
} | null>(null);

type EngineHandles = {
  engine: Engine;
  conversation: Conversation;
  model: Model;
};

type LoadOutcome = {
  model: Model;
  status: "ready" | "error";
  error: string | null;
};

// How long runtime cleanup (or the post-stop conversation swap) may take
// before the engine is declared wedged (google-ai-edge/LiteRT-LM#2422) and
// the wasm runtime is fully reset.
const WEDGE_TIMEOUT_MS = 150;

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
  const [isRecovering, setIsRecovering] = React.useState(false);

  const isModelCached =
    activeModel != null && models[activeModel].status === "cached";
  const engineStatus: EngineStatus =
    !activeModel || !isModelCached
      ? "idle"
      : isRecovering
        ? "recovering"
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
  const transcriptRef = React.useRef<LlmMessage[]>([]);

  function patchMessage(
    id: number,
    patch: (message: ChatMessage) => ChatMessage,
  ) {
    setMessages((prev) =>
      prev.map((message) => (message.id === id ? patch(message) : message)),
    );
  }

  function cancelGeneration() {
    generationTokenRef.current++;
    setIsGenerating(false);
    const reader = readerRef.current;
    readerRef.current = null;
    if (!reader) return;
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
      })().catch((err) => {
        console.error("Failed to delete the engine:", err);
      }),
      timeout(WEDGE_TIMEOUT_MS),
    ]);
    if (result === "timeout") {
      hardResetLiteRtLm();
    }
  }

  async function createHandles(model: Model, token: number, preface?: Preface) {
    const [file] = await Promise.all([getModelFile(model), ensureLiteRtLm()]);
    if (!file) {
      remove(model);
      throw new Error(
        "The cached model file was missing or corrupted and has been removed. Download it again to use this model.",
      );
    }
    if (token !== loadTokenRef.current) return null;
    const engine = await Engine.create({ model: file });
    let conversation: Conversation;
    try {
      conversation = await engine.createConversation(
        preface ? { preface } : undefined,
      );
    } catch (err) {
      await engine.delete().catch(() => {});
      throw err;
    }
    if (token !== loadTokenRef.current) {
      await conversation.delete().catch(() => {});
      await engine.delete().catch(() => {});
      return null;
    }
    return { engine, conversation, model };
  }

  async function swapConversation(handles: EngineHandles, preface?: Preface) {
    const stale = handles.conversation;
    const conversation = await handles.engine.createConversation(
      preface ? { preface } : undefined,
    );
    if (handlesRef.current !== handles) {
      await conversation.delete().catch(() => {});
      return false;
    }
    handles.conversation = conversation;
    await stale.delete();
    return true;
  }

  async function loadModel(model: Model, token: number, preface?: Preface) {
    try {
      const handles = await createHandles(model, token, preface);
      if (!handles) return;
      handlesRef.current = handles;
      setLoadOutcome({ model, status: "ready", error: null });
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
  }

  const loadEngine = React.useEffectEvent(
    (model: Model | null, isCached: boolean) => {
      const token = ++loadTokenRef.current;

      engineOpsRef.current = engineOpsRef.current.then(async () => {
        await teardownEngine();
        if (token !== loadTokenRef.current) return;
        setMessages([]);
        setIsGenerating(false);
        setLoadOutcome(null);
        transcriptRef.current = [];
        if (!model || !isCached) return;
        await loadModel(model, token);
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
    const patchAssistant = (patch: (message: ChatMessage) => ChatMessage) =>
      patchMessage(assistantId, patch);

    let responseRole = "model";
    let responseText = "";
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
        if (value.role) responseRole = value.role;
        const delta = extractText(value);
        if (!delta) continue;
        responseText += delta;
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
      if (responseText) {
        transcriptRef.current.push({
          role: responseRole,
          content: responseText,
        });
      }
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
    transcriptRef.current.push({ role: "user", content: trimmed });

    const previous = generationRef.current;
    generationRef.current = (async () => {
      await previous;
      if (token !== generationTokenRef.current) return;
      const current = handlesRef.current;
      if (!current) {
        setIsGenerating(false);
        patchMessage(assistantId, (message) => ({
          ...message,
          error: "The model is no longer loaded",
        }));
        return;
      }
      await runGeneration(current, trimmed, assistantId, token);
    })();
  }

  function stop() {
    const handles = handlesRef.current;
    if (!handles || !isGenerating) return;
    cancelGeneration();

    setMessages((prev) => {
      const last = prev.at(-1);
      return last?.role === "assistant" && !last.content && !last.error
        ? prev.slice(0, -1)
        : prev;
    });

    const loadToken = loadTokenRef.current;
    const previous = generationRef.current;
    generationRef.current = (async () => {
      await previous;
      if (handlesRef.current !== handles) return;
      if (loadToken !== loadTokenRef.current) return;

      const preface: Preface = { messages: [...transcriptRef.current] };
      const done = await Promise.race([
        swapConversation(handles, preface)
          .then(() => true)
          .catch((err: unknown) => {
            console.error("Failed to swap the conversation after stop:", err);
            return false;
          }),
        timeout(WEDGE_TIMEOUT_MS).then(() => false),
      ]);
      if (done) return;
      if (loadToken !== loadTokenRef.current) return;

      handlesRef.current = null;
      setLoadOutcome(null);
      setIsRecovering(true);
      try {
        hardResetLiteRtLm();
        await loadModel(handles.model, loadToken, preface);
      } finally {
        setIsRecovering(false);
      }
    })();
  }

  function restart() {
    generationTokenRef.current++;
    setIsGenerating(false);
    setMessages([]);
    transcriptRef.current = [];

    const handles = handlesRef.current;
    if (!handles) return;
    const previous = generationRef.current;
    generationRef.current = (async () => {
      await previous;
      if (handlesRef.current !== handles) return;
      try {
        await swapConversation(handles);
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
        stop,
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
