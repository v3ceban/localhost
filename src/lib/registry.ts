export const MODELS = {
  "gemma-4-e2b": {
    label: "Gemma 4 E2B",
    file: "gemma-4-E2B-it-web.litertlm",
    url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm",
  },
  "gemma-4-e4b": {
    label: "Gemma 4 E4B",
    file: "gemma-4-E4B-it-web.litertlm",
    url: "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm",
  },
} as const satisfies Record<string, ModelDetails>;

type ModelDetails = { label: string; file: string; url: string };

export type Model = keyof typeof MODELS;

export const DEFAULT_MODEL: Model = "gemma-4-e2b";
