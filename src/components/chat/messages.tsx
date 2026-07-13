"use client";

import { BotIcon } from "lucide-react";
import { MODELS } from "@/lib/registry";
import { useModelCache } from "@/hooks/use-model-cache";
import {
  useLlmChat,
  type ChatMessage,
  type EngineStatus,
} from "@/hooks/use-llm-chat";
import { Message, MessageContent } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";

function emptyStateFor(
  status: EngineStatus,
  modelLabel: string | null,
  error: string | null,
): { title: string; description: string } {
  switch (status) {
    case "idle":
      return {
        title: "No model active",
        description:
          "Download a model and activate it to chat fully on-device.",
      };
    case "loading":
      return {
        title: `Loading ${modelLabel ?? "model"}…`,
        description: "The model is being loaded into memory. Hang tight.",
      };
    case "error":
      return {
        title: "Model failed to load",
        description: error ?? "Something went wrong while loading the model.",
      };
    case "ready":
      return {
        title: "Ready when you are",
        description:
          "Everything runs in this browser. The chat is wiped on refresh.",
      };
  }
}

function ChatEmpty() {
  const { activeModel, remove } = useModelCache();
  const { engineStatus, engineError } = useLlmChat();
  const { title, description } = emptyStateFor(
    engineStatus,
    activeModel ? MODELS[activeModel].label : null,
    engineError,
  );

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {engineStatus === "loading" ? <Spinner /> : <BotIcon />}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {engineStatus === "error" && activeModel && (
        <EmptyContent>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => remove(activeModel)}
          >
            Remove cached model
          </Button>
          <EmptyDescription>
            If loading keeps failing, the downloaded file may be corrupted.
          </EmptyDescription>
        </EmptyContent>
      )}
    </Empty>
  );
}

function ChatBubble({
  message,
  isPending,
}: {
  message: ChatMessage;
  isPending: boolean;
}) {
  const align = message.role === "user" ? "end" : "start";

  return (
    <Message align={align}>
      <MessageContent>
        <Bubble
          align={align}
          variant={message.role === "user" ? "default" : "ghost"}
        >
          <BubbleContent className="whitespace-pre-wrap">
            {message.content}
            {isPending && !message.content && <Spinner />}
          </BubbleContent>
        </Bubble>
        {message.error && (
          <p role="alert" className="text-xs text-destructive">
            {message.error}
          </p>
        )}
      </MessageContent>
    </Message>
  );
}

export function ChatMessages() {
  const { messages, isGenerating } = useLlmChat();

  if (messages.length === 0) return <ChatEmpty />;

  const lastMessage = messages.at(-1);

  return (
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="py-4">
            {messages.map((message) => (
              <MessageScrollerItem key={message.id}>
                <ChatBubble
                  message={message}
                  isPending={
                    isGenerating &&
                    message.role === "assistant" &&
                    message.id === lastMessage?.id
                  }
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
