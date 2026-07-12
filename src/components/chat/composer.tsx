"use client";

import * as React from "react";
import { ArrowUpIcon, RotateCcwIcon } from "lucide-react";
import { MODELS, type Model } from "@/lib/registry";
import { useModelCache } from "@/hooks/use-model-cache";
import { useLlmChat, type EngineStatus } from "@/hooks/use-llm-chat";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ModelDownloadDialogTrigger } from "@/components/model-download/dialog";
import { ChatModelSelector } from "@/components/chat/model-selector";

function placeholderFor(status: EngineStatus, model: Model | null): string {
  switch (status) {
    case "idle":
      return "Download and activate a model to start chatting";
    case "loading":
      return model ? `Loading ${MODELS[model].label}…` : "Loading model…";
    case "error":
      return "The model failed to load";
    case "ready":
      return model ? `Message ${MODELS[model].label}` : "Send a message";
  }
}

export function ChatComposer({ query = "" }) {
  const { activeModel } = useModelCache();
  const { engineStatus, messages, isGenerating, send, restart } = useLlmChat();
  const [input, setInput] = React.useState(query);

  const canSend =
    engineStatus === "ready" && !isGenerating && input.trim().length > 0;

  function submit() {
    if (!canSend) return;
    send(input);
    setInput("");
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      autoComplete="off"
    >
      <InputGroup className="dark:has-disabled:bg-input/30 has-disabled:bg-transparent has-disabled:opacity-100">
        <InputGroupTextarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="p-4"
          placeholder={placeholderFor(engineStatus, activeModel)}
          disabled={engineStatus !== "ready"}
          autoComplete="off"
          aria-label="Chat message"
        />
        <InputGroupAddon align="block-end" className="cursor-default gap-1.5">
          <ModelDownloadDialogTrigger variant="ghost" size="icon-sm" />
          <ChatModelSelector />
          <InputGroupButton
            size="icon-sm"
            className="ml-auto disabled:pointer-events-auto disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-inherit"
            disabled={isGenerating || messages.length === 0}
            onClick={restart}
            aria-label="Restart chat"
          >
            <RotateCcwIcon />
          </InputGroupButton>
          <InputGroupButton
            type="submit"
            size="icon-sm"
            variant="default"
            disabled={!canSend}
            aria-label="Send message"
            className="disabled:hover:bg-primary disabled:pointer-events-auto disabled:cursor-not-allowed"
          >
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
