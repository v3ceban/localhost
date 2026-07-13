"use client";

import * as React from "react";
import { toast } from "sonner";
import { MODEL_IDS, MODELS, type Model } from "@/lib/registry";
import { errorMessage } from "@/lib/utils";
import {
  deleteModel,
  downloadModel,
  getCachedStatus,
  type CachedStatusTag,
  type DownloadProgress,
} from "@/lib/opfs-cache";
import { ModelDownloadToast } from "@/components/model-download/toast";

const TOAST_THROTTLE_MS = 350;

type ModelStatus = "unknown" | CachedStatusTag | "downloading" | "error";

export type ModelState = {
  status: ModelStatus;
  loaded: number;
  total: number | null;
  error: string | null;
};

type ModelCacheState = Record<Model, ModelState>;

export function isDownloadActive(status: ModelStatus): boolean {
  return status === "downloading" || status === "paused";
}

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
      MODEL_IDS.map((model) => [model, defaultModelState("unknown")]),
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
    if (!isDownloadActive(state.status)) {
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

  const modelsRef = React.useRef(models);

  function commitModel(model: Model) {
    setModels(modelsRef.current);
    showToast(model, modelsRef.current[model]);
  }

  function patchModel(
    model: Model,
    patch: Partial<ModelState>,
    throttle = false,
  ) {
    modelsRef.current = {
      ...modelsRef.current,
      [model]: { ...modelsRef.current[model], ...patch },
    };
    if (!throttle) {
      commitModel(model);
      return;
    }

    const control = getToastControl(model);
    const elapsed = Date.now() - (control.lastShownAt ?? 0);
    if (elapsed >= TOAST_THROTTLE_MS) {
      control.lastShownAt = Date.now();
      commitModel(model);
      return;
    }
    control.timer ??= setTimeout(() => {
      delete control.timer;
      control.lastShownAt = Date.now();
      commitModel(model);
    }, TOAST_THROTTLE_MS - elapsed);
  }

  const patchModelEvent = React.useEffectEvent(patchModel);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const entries = await Promise.all(
        MODEL_IDS.map(async (model) => {
          const cached = await getCachedStatus(model);
          return [model, cached] as const;
        }),
      );
      if (controller.signal.aborted) return;
      for (const [model, cached] of entries) {
        patchModelEvent(model, cached);
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
        const message = errorMessage(err, "Download failed");
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
        MODEL_IDS.find(
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
