"use client";

import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import type { ModelState } from "@/hooks/use-model-cache";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Progress } from "@/components/ui/progress";

export function downloadStatusLabel(status: ModelState["status"]): string {
  return status === "paused" ? "Paused" : "Downloading…";
}

export function ModelDownloadProgress({
  id,
  state,
  className,
  onPause,
  onResume,
  onCancel,
}: {
  id: string;
  state: ModelState;
  className?: string;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const value =
    state.total != null && state.total > 0
      ? Math.min(state.loaded, state.total)
      : null;
  const byteLabelId = `${id}-bytes`;

  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2",
        className,
      )}
    >
      <Progress
        value={value}
        max={state.total ?? undefined}
        aria-describedby={byteLabelId}
        className="col-span-2"
      />
      <p
        id={byteLabelId}
        className="col-start-1 text-xs text-muted-foreground tabular-nums"
      >
        {formatBytes(state.loaded)}
        {state.total != null ? ` / ${formatBytes(state.total)}` : ""}
      </p>
      <ButtonGroup className="col-start-2">
        {state.status === "downloading" ? (
          <Button variant="outline" size="icon-sm" onClick={onPause}>
            <PauseIcon />
            <span className="sr-only">Pause</span>
          </Button>
        ) : (
          <Button variant="outline" size="icon-sm" onClick={onResume}>
            <PlayIcon />
            <span className="sr-only">Resume</span>
          </Button>
        )}
        <Button variant="outline" size="icon-sm" onClick={onCancel}>
          <XIcon />
          <span className="sr-only">Cancel</span>
        </Button>
      </ButtonGroup>
    </div>
  );
}
