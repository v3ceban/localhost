export const MODELS = {
  "gemma-4-e2b": {
    label: "Gemma 4 E2B",
    file: "gemma-4-E2B-it-web.litertlm",
    url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm",
    description:
      "2 billion parameters, smaller and faster, good for quick responses or lower-end devices.",
  },
  "gemma-4-e4b": {
    label: "Gemma 4 E4B",
    file: "gemma-4-E4B-it-web.litertlm",
    url: "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm",
    description:
      "4 billion parameters, larger and more capable, better quality but slower, needs a higher-end device.",
  },
} as const satisfies Record<string, ModelDetails>;

type ModelDetails = {
  label: string;
  file: string;
  url: string;
  description: string;
};

export type Model = keyof typeof MODELS;

export const MODEL_IDS = Object.keys(MODELS) as Model[];
