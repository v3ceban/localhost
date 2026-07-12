"use client";

import * as React from "react";
import { toast } from "sonner";
import { MODELS, type Model } from "@/lib/registry";
import {
  deleteModel,
  downloadModel,
  getCachedStatus,
  isModelCached,
  type CachedStatusTag,
  type DownloadProgress,
} from "@/lib/opfs-cache";
import { ModelDownloadToast } from "@/components/model-download/toast";

type ModelStatus = "unknown" | CachedStatusTag | "downloading" | "error";

export type ModelState = {
  status: ModelStatus;
  loaded: number;
  total: number | null;
  error: string | null;
};

type ModelCacheState = Record<Model, ModelState>;

const ModelCacheContext = React.createContext<{
  models: ModelCacheState;
  download: (model: Model) => void;
  pause: (model: Model) => void;
  cancel: (model: Model) => void;
  remove: (model: Model) => void;
} | null>(null);

function defaultModelState(status: ModelStatus): ModelState {
  return { status, loaded: 0, total: null, error: null };
}

const TOAST_ID_PREFIX = "model-download-";

export function ModelCacheProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [models, setModels] = React.useState(() => {
    return Object.fromEntries(
      Object.keys(MODELS).map((model) => [model, defaultModelState("unknown")]),
    ) as ModelCacheState;
  });
  const controllers = React.useRef<Partial<Record<Model, AbortController>>>({});

  function patchModel(model: Model, patch: Partial<ModelState>) {
    setModels((prev) => ({
      ...prev,
      [model]: { ...prev[model], ...patch },
    }));
  }

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const entries = await Promise.all(
        (Object.keys(MODELS) as Model[]).map(async (model) => {
          const cached = await getCachedStatus(model);
          return [model, cached] as const;
        }),
      );
      if (controller.signal.aborted) return;
      setModels((prev) => {
        const next = { ...prev };
        for (const [model, cached] of entries) {
          if (cached.status === "cached") {
            next[model] = { ...next[model], status: "cached" };
          } else if (cached.status === "paused") {
            next[model] = {
              ...next[model],
              status: "paused",
              loaded: cached.loaded,
              total: cached.total,
            };
          } else {
            next[model] = { ...next[model], status: "idle" };
          }
        }
        return next;
      });
    })();
    return () => {
      controller.abort();
    };
  }, []);

  function download(model: Model) {
    const controller = new AbortController();
    controllers.current[model] = controller;
    patchModel(model, { status: "downloading", error: null });

    const isCurrent = () => controllers.current[model] === controller;

    const onProgress = (progress: DownloadProgress) => {
      if (!isCurrent()) return;
      patchModel(model, {
        status: "downloading",
        loaded: progress.loaded,
        total: progress.total,
      });
    };

    void downloadModel(model, controller.signal, onProgress)
      .then(() => {
        if (!isCurrent() || controller.signal.aborted) return;
        patchModel(model, { status: "cached", error: null });
        toast.dismiss(TOAST_ID_PREFIX + model);
      })
      .catch((err: unknown) => {
        if (!isCurrent()) return;
        if (controller.signal.aborted) {
          if (controller.signal.reason !== "cancel") {
            patchModel(model, { status: "paused" });
          }
          return;
        }
        const message = err instanceof Error ? err.message : "Download failed";
        patchModel(model, { status: "error", error: message });
        toast.dismiss(TOAST_ID_PREFIX + model);
        toast.error(`${MODELS[model].label} failed to download`, {
          description: message,
        });
      })
      .finally(() => {
        if (isCurrent()) delete controllers.current[model];
      });
  }

  function pause(model: Model) {
    controllers.current[model]?.abort();
  }

  function cancel(model: Model) {
    controllers.current[model]?.abort("cancel");
    delete controllers.current[model];
    toast.dismiss(TOAST_ID_PREFIX + model);

    void isModelCached(model).then((hasOldCopy) => {
      if (controllers.current[model]) return;
      if (hasOldCopy) {
        void deleteModel(model, true).then(() => {
          if (controllers.current[model]) return;
          patchModel(model, { status: "cached", error: null });
        });
      } else {
        remove(model);
      }
    });
  }

  function remove(model: Model) {
    void deleteModel(model).then(() => {
      patchModel(model, defaultModelState("idle"));
    });
  }

  const downloadEvent = React.useEffectEvent(download);
  const cancelEvent = React.useEffectEvent(cancel);

  React.useEffect(() => {
    for (const key of Object.keys(models) as Model[]) {
      const state = models[key];
      const toastId = TOAST_ID_PREFIX + key;
      if (state.status === "downloading" || state.status === "paused") {
        toast.custom(
          () => (
            <ModelDownloadToast
              model={key}
              state={state}
              onPause={() => pause(key)}
              onResume={() => downloadEvent(key)}
              onCancel={() => cancelEvent(key)}
            />
          ),
          { id: toastId, duration: Infinity },
        );
      }
    }
  }, [models]);

  return (
    <ModelCacheContext.Provider
      value={{
        models,
        download,
        pause,
        cancel,
        remove,
      }}
    >
      {children}
    </ModelCacheContext.Provider>
  );
}

export function useModelCache() {
  const context = React.useContext(ModelCacheContext);
  if (!context) {
    throw new Error("useModelCache must be used within a ModelCacheProvider");
  }
  return context;
}
