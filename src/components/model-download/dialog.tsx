"use client";

import * as React from "react";
import {
  CheckIcon,
  DownloadIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import { MODEL_IDS, MODELS, type Model } from "@/lib/registry";
import {
  isDownloadActive,
  useModelCache,
  type ModelState,
} from "@/hooks/use-model-cache";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  downloadStatusLabel,
  ModelDownloadProgress,
} from "@/components/model-download/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function ModelRow({ model, state }: { model: Model; state: ModelState }) {
  const { download, pause, cancel, remove, activeModel, setActiveModel } =
    useModelCache();
  const id = `model-row-${model}`;
  const isActive = isDownloadActive(state.status);
  const isActiveModel = model === activeModel;

  if (state.status === "unknown") {
    return (
      <li className="flex items-center justify-between gap-2 rounded-lg border p-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-24" />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 rounded-lg border p-3",
        isActiveModel && "border-muted-foreground",
      )}
    >
      <p className="col-start-1 text-sm font-medium">{MODELS[model].label}</p>
      <p className="text-muted-foreground col-span-full text-xs">
        {MODELS[model].description}
      </p>
      {isActive && (
        <p
          role="status"
          aria-live="polite"
          className="text-muted-foreground col-start-2 row-start-1 text-xs"
        >
          {downloadStatusLabel(state.status)}
        </p>
      )}
      {(state.status === "idle" || state.status === "error") && (
        <Button
          variant="outline"
          size="sm"
          className="col-start-2 row-start-1"
          onClick={() => download(model)}
        >
          <DownloadIcon />
          {state.status === "error" ? "Retry" : "Download"}
        </Button>
      )}
      {state.status === "cached" && (
        <ButtonGroup className="col-start-2 row-start-1">
          <Button variant="outline" size="sm" onClick={() => remove(model)}>
            <Trash2Icon />
            Delete
          </Button>
          {isActiveModel ? (
            <Button
              className={"disabled:opacity-100"}
              variant="default"
              size="sm"
              disabled
            >
              <CheckIcon />
              Active
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setActiveModel(model)}
            >
              <CheckIcon />
              Activate
            </Button>
          )}
        </ButtonGroup>
      )}
      {isActive && (
        <ModelDownloadProgress
          id={id}
          state={state}
          className="col-span-2"
          onPause={() => pause(model)}
          onResume={() => download(model)}
          onCancel={() => cancel(model)}
        />
      )}
      {state.status === "error" && state.error && (
        <p role="alert" className="text-destructive col-span-2 text-xs">
          {state.error}
        </p>
      )}
    </li>
  );
}

function ModelDownloadDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactElement;
}) {
  const { models } = useModelCache();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={children} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage models</DialogTitle>
          <DialogDescription>
            Download models for offline, on-device inference. Files are stored
            in this browser only.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {MODEL_IDS.map((model) => (
            <ModelRow key={model} model={model} state={models[model]} />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function ModelDownloadDialogTrigger({
  variant = "outline",
  size = "icon",
  children,
  ...props
}: ButtonProps) {
  const { models } = useModelCache();
  const [open, setOpen] = React.useState(false);
  const setOpenEvent = React.useEffectEvent(setOpen);

  const statuses = Object.values(models).map((model) => model.status);
  const isChecked = !statuses.includes("unknown");
  const hasCachedModel = statuses.includes("cached");

  React.useEffect(() => {
    if (isChecked && !hasCachedModel) setOpenEvent(true);
  }, [isChecked, hasCachedModel]);

  return (
    <ModelDownloadDialog open={open} onOpenChange={setOpen}>
      <Button variant={variant} size={size} {...props}>
        {children ?? (
          <>
            <SettingsIcon />
            <span className="sr-only">Manage models</span>
          </>
        )}
      </Button>
    </ModelDownloadDialog>
  );
}
