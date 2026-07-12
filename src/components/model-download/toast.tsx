"use client";

import { MODELS, type Model } from "@/lib/registry";
import { type ModelState } from "@/hooks/use-model-cache";
import { ModelDownloadProgress } from "@/components/model-download/progress";

export function ModelDownloadToast({
  model,
  state,
  onPause,
  onResume,
  onCancel,
}: {
  model: Model;
  state: ModelState;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const id = `model-download-toast-${model}`;

  return (
    <section
      aria-labelledby={`${id}-label`}
      role="status"
      aria-live="polite"
      className="grid w-[min(24rem,calc(100vw-2rem))] grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 rounded-xl bg-popover p-4 ring-1 ring-foreground/10"
    >
      <p id={`${id}-label`} className="col-start-1 text-sm font-medium">
        {MODELS[model].label}
      </p>
      <p className="col-start-2 text-xs text-muted-foreground">
        {state.status === "paused" ? "Paused" : "Downloading…"}
      </p>
      <ModelDownloadProgress
        id={id}
        state={state}
        className="col-span-2"
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
      />
    </section>
  );
}
