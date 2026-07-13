import {
  getGlobalLiteRtLm,
  getOrLoadGlobalLiteRtLm,
  hasGlobalLiteRtLm,
  unloadLiteRtLm,
  type LiteRtLm,
} from "@litert-lm/core";
import { env } from "@/env";

type LogChannel = (message: string) => void;

const isProd = env.NODE_ENV === "production";
const drop: LogChannel = () => {};

const LOG_CHANNELS: [RegExp, LogChannel][] = [
  [/^(?:[EF]\d|ERROR|FATAL)/, console.error],
  [/^(?:W\d|WARNING)/, isProd ? drop : console.warn],
  [/^(?:I\d|INFO)/, isProd ? drop : console.info],
  [/^(?:[VD]\d|VLOG|DEBUG)/, isProd ? drop : console.debug],
];

function routeLog(line: string, fallback: LogChannel) {
  for (const [pattern, channel] of LOG_CHANNELS) {
    if (pattern.test(line)) {
      channel(line);
      return;
    }
  }
  fallback(line);
}

let logRouterInstalled = false;

function installWasmLogRouter() {
  if (logRouterInstalled) return;
  logRouterInstalled = true;
  (
    globalThis as unknown as {
      Module?: { print: LogChannel; printErr: LogChannel };
    }
  ).Module = {
    print: (line) => routeLog(line, isProd ? drop : console.log),
    printErr: (line) => routeLog(line, console.error),
  };
}

export function ensureLiteRtLm(): Promise<LiteRtLm> {
  installWasmLogRouter();
  return getOrLoadGlobalLiteRtLm();
}

export function hardResetLiteRtLm() {
  try {
    if (hasGlobalLiteRtLm()) {
      getGlobalLiteRtLm().liteRtLmWasm.preinitializedWebGPUDevice?.destroy();
    }
  } catch (err) {
    console.error("Failed to destroy the WebGPU device:", err);
  }
  try {
    unloadLiteRtLm();
  } catch (err) {
    console.error("Failed to unload LiteRT-LM:", err);
  }
  logRouterInstalled = false;
}
