import { createEnv } from "@t3-oss/env-core";
import { vercel } from "@t3-oss/env-core/presets-zod";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  clientPrefix: "NEXT_PUBLIC_",
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  extends: [vercel()],
  server: {},
  client: {},
  shared: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },
  runtimeEnvStrict: {
    NODE_ENV: process.env.NODE_ENV,
  },
});
