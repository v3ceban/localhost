"use client";

import * as React from "react";
import { toast } from "sonner";
import { MODELS, type Model } from "@/lib/registry";
import {
  deleteModel,
  downloadModel,
  getCachedStatus,
  type CachedStatusTag,
  type DownloadProgress,
} from "@/lib/opfs-cache";
import { ModelDownloadToast } from "@/components/model-download/toast";

const TOAST_THROTTLE_MS = 333;

type ModelStatus = "unknown" | CachedStatusTag | "downloading" | "error";

export type ModelState = {
  status: ModelStatus;
  loaded: number;
  total: number | null;
  error: string | null;
};

type ModelCacheState = Record<Model, ModelState>;

type ToastControl = {
  dismissed?: boolean;
  lastShownAt?: number;
  timer?: ReturnType<typeof setTimeout>;
};

const ModelCacheContext = React.createContext<{
  models: ModelCacheState;
  download: (model: Model) => void;
  pause: (model: Model) => void;
  cancel: (model: Model) => void;
  remove: (model: Model) => void;
  activeModel: Model | null;
  setActiveModel: (model: Model | null) => void;
} | null>(null);

function defaultModelState(status: ModelStatus): ModelState {
  return { status, loaded: 0, total: null, error: null };
}

const TOAST_ID_PREFIX = "model-download-";
const ACTIVE_MODEL_STORAGE_KEY = "active-model";

function isModel(value: string | null): value is Model {
  return value != null && value in MODELS;
}

function readStoredActiveModel(): Model | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(ACTIVE_MODEL_STORAGE_KEY);
  return isModel(stored) ? stored : null;
}

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
  const [activeModel, setActiveModel] = React.useState<Model | null>(null);
  const controllers = React.useRef<Partial<Record<Model, AbortController>>>({});

  const setActiveModelEvent = React.useEffectEvent(setActiveModel);

  React.useEffect(() => {
    setActiveModelEvent(readStoredActiveModel());
  }, []);

  function handleSetActiveModel(model: Model | null) {
    setActiveModel(model);
    if (model) {
      window.localStorage.setItem(ACTIVE_MODEL_STORAGE_KEY, model);
    } else {
      window.localStorage.removeItem(ACTIVE_MODEL_STORAGE_KEY);
    }
  }

  const toastControls = React.useRef<Partial<Record<Model, ToastControl>>>({});

  function getToastControl(model: Model): ToastControl {
    return (toastControls.current[model] ??= {});
  }

  function showToast(model: Model, state: ModelState) {
    const control = getToastControl(model);
    clearTimeout(control.timer);
    delete control.timer;
    if (state.status !== "downloading" && state.status !== "paused") {
      toast.dismiss(TOAST_ID_PREFIX + model);
      return;
    }
    if (control.dismissed) return;
    toast.custom(
      () => (
        <ModelDownloadToast
          model={model}
          state={state}
          onPause={() => pause(model)}
          onResume={() => download(model)}
          onCancel={() => cancel(model)}
        />
      ),
      {
        id: TOAST_ID_PREFIX + model,
        duration: Infinity,
        onDismiss: () => {
          control.dismissed = true;
        },
      },
    );
  }

  function throttleToast(model: Model, state: ModelState) {
    const control = getToastControl(model);
    const elapsed = Date.now() - (control.lastShownAt ?? 0);
    if (elapsed >= TOAST_THROTTLE_MS) {
      control.lastShownAt = Date.now();
      showToast(model, state);
      return;
    }

    clearTimeout(control.timer);
    control.timer = setTimeout(() => {
      control.lastShownAt = Date.now();
      showToast(model, state);
    }, TOAST_THROTTLE_MS - elapsed);
  }

  const modelsRef = React.useRef(models);

  function patchModel(
    model: Model,
    patch: Partial<ModelState>,
    throttle = false,
  ) {
    const state = { ...modelsRef.current[model], ...patch };
    modelsRef.current = { ...modelsRef.current, [model]: state };
    setModels(modelsRef.current);
    if (throttle) {
      throttleToast(model, state);
    } else {
      showToast(model, state);
    }
  }

  const patchModelEvent = React.useEffectEvent(patchModel);

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
      for (const [model, cached] of entries) {
        if (cached.status === "paused") {
          patchModelEvent(model, {
            status: "paused",
            loaded: cached.loaded,
            total: cached.total,
          });
        } else if (cached.status === "cached") {
          patchModelEvent(model, { status: "cached" });
        } else {
          patchModelEvent(model, { status: "idle" });
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  function download(model: Model) {
    getToastControl(model).dismissed = false;
    const controller = new AbortController();
    controllers.current[model] = controller;
    patchModel(model, { status: "downloading", error: null });

    const isCurrent = () => controllers.current[model] === controller;

    const onProgress = (progress: DownloadProgress) => {
      if (!isCurrent()) return;
      patchModel(
        model,
        {
          status: "downloading",
          loaded: progress.loaded,
          total: progress.total,
        },
        true,
      );
    };

    void downloadModel(model, controller.signal, onProgress)
      .then(() => {
        if (!isCurrent() || controller.signal.aborted) return;
        patchModel(model, { status: "cached", error: null });
        if (activeModel === null) handleSetActiveModel(model);
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
        toast.error(`${MODELS[model].label} failed to download`, {
          description: message,
        });
      })
      .finally(() => {
        if (isCurrent()) delete controllers.current[model];
      });
  }

  function pause(model: Model) {
    getToastControl(model).dismissed = false;
    controllers.current[model]?.abort();
  }

  function cancel(model: Model) {
    controllers.current[model]?.abort("cancel");
    delete controllers.current[model];
    remove(model);
  }

  function remove(model: Model) {
    void deleteModel(model).then(() => {
      patchModel(model, defaultModelState("idle"));
      if (model !== activeModel) return;
      const nextActiveModel =
        (Object.keys(MODELS) as Model[]).find(
          (candidate) =>
            candidate !== model &&
            modelsRef.current[candidate].status === "cached",
        ) ?? null;
      handleSetActiveModel(nextActiveModel);
    });
  }

  return (
    <ModelCacheContext.Provider
      value={{
        models,
        download,
        pause,
        cancel,
        remove,
        activeModel,
        setActiveModel: handleSetActiveModel,
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
