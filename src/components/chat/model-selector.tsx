"use client";

import { MODEL_IDS, MODELS } from "@/lib/registry";
import { useModelCache } from "@/hooks/use-model-cache";
import { useLlmChat } from "@/hooks/use-llm-chat";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MODEL_LABELS = Object.fromEntries(
  MODEL_IDS.map((model) => [model, MODELS[model].label]),
);

export function ChatModelSelector() {
  const { models, activeModel, setActiveModel } = useModelCache();
  const { engineStatus } = useLlmChat();

  return (
    <Select
      items={MODEL_LABELS}
      value={activeModel}
      onValueChange={(model) => {
        if (model) setActiveModel(model);
      }}
    >
      <SelectTrigger size="sm" aria-label="Select model">
        {engineStatus === "loading" && <Spinner />}
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent className="min-w-fit">
        {MODEL_IDS.map((model) => (
          <SelectItem
            key={model}
            value={model}
            disabled={models[model].status !== "cached"}
          >
            {MODELS[model].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
