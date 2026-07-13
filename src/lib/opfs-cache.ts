import { MODELS, type Model } from "@/lib/registry";

const PART_SUFFIX = ".part";
const META_SUFFIX = ".meta";

async function getModelsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("models", { create: true });
}

async function getFileHandle(
  fileName: string,
  create: true,
): Promise<FileSystemFileHandle>;
async function getFileHandle(
  fileName: string,
  create: false,
): Promise<FileSystemFileHandle | null>;
async function getFileHandle(
  fileName: string,
  create: boolean,
): Promise<FileSystemFileHandle | null> {
  const dir = await getModelsDir();
  if (create) return dir.getFileHandle(fileName, { create: true });
  try {
    return await dir.getFileHandle(fileName, { create: false });
  } catch {
    return null;
  }
}

async function getFileSize(fileName: string): Promise<number> {
  const handle = await getFileHandle(fileName, false);
  if (!handle) return 0;
  const file = await handle.getFile();
  return file.size;
}

async function deleteFile(fileName: string): Promise<void> {
  const dir = await getModelsDir();
  await dir.removeEntry(fileName).catch(() => {});
}

type ModelMeta = {
  total: number;
  etag: string | null;
};

async function writeMeta(file: string, meta: ModelMeta): Promise<void> {
  const handle = await getFileHandle(file + META_SUFFIX, true);
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

async function readMeta(file: string): Promise<ModelMeta | null> {
  const handle = await getFileHandle(file + META_SUFFIX, false);
  if (!handle) return null;
  const text = await (await handle.getFile()).text();
  let total: number;
  let etag: string | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const meta = parsed as Partial<ModelMeta>;
    total = Number(meta.total);
    etag = typeof meta.etag === "string" ? meta.etag : null;
  } catch {
    total = Number(text);
  }
  return Number.isFinite(total) && total > 0 ? { total, etag } : null;
}

export async function isModelCached(model: Model): Promise<boolean> {
  const handle = await getFileHandle(MODELS[model].file, false);
  if (!handle) return false;
  const file = await handle.getFile();
  if (file.size === 0) return false;
  const meta = await readMeta(MODELS[model].file);
  return meta == null || file.size === meta.total;
}

export async function getCachedModelSize(model: Model): Promise<number> {
  return getFileSize(MODELS[model].file);
}

export type CachedStatus =
  | { status: "cached" }
  | { status: "paused"; loaded: number; total: number | null }
  | { status: "idle" };

export type CachedStatusTag = CachedStatus["status"];

export async function getCachedStatus(model: Model): Promise<CachedStatus> {
  const { file } = MODELS[model];
  const partSize = await getFileSize(file + PART_SUFFIX);
  if (partSize > 0) {
    const meta = await readMeta(file);
    return { status: "paused", loaded: partSize, total: meta?.total ?? null };
  }
  if (await isModelCached(model)) return { status: "cached" };
  return { status: "idle" };
}

export async function deleteModel(model: Model): Promise<void> {
  const { file } = MODELS[model];
  await Promise.all([
    deleteFile(file),
    deleteFile(file + PART_SUFFIX),
    deleteFile(file + META_SUFFIX),
  ]);
}

export type DownloadProgress = {
  loaded: number;
  total: number | null;
};

function getTotalSize(response: Response, startOffset: number): number | null {
  const contentRange = response.headers.get("Content-Range");
  if (contentRange) {
    const total = contentRange.split("/")[1];
    if (total && total !== "*") return Number(total);
  }
  const contentLength = response.headers.get("Content-Length");
  if (contentLength) return startOffset + Number(contentLength);
  return null;
}

export async function downloadModel(
  model: Model,
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  const { file, url } = MODELS[model];
  const partName = file + PART_SUFFIX;

  const partHandle = await getFileHandle(partName, true);
  const startOffset = (await partHandle.getFile()).size;

  const headers: Record<string, string> = {};
  if (startOffset > 0) {
    headers.Range = `bytes=${startOffset}-`;
    const etag = (await readMeta(file))?.etag;
    if (etag) headers["If-Range"] = etag;
  }

  const response = await fetch(url, { signal, headers });

  if (response.status === 416) {
    await deleteFile(partName);
    await deleteFile(file + META_SUFFIX);
    throw new Error(
      "The previous download could not be resumed and was discarded. Try downloading again.",
    );
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`Failed to download model: ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Response has no body");
  }

  const isRangeSatisfied = response.status === 206;
  const writable = await partHandle.createWritable({
    keepExistingData: isRangeSatisfied,
  });
  if (isRangeSatisfied) {
    await writable.seek(startOffset);
  } else {
    await writable.truncate(0);
  }

  let loaded = isRangeSatisfied ? startOffset : 0;
  const total = getTotalSize(response, loaded);
  if (total != null) {
    await writeMeta(file, { total, etag: response.headers.get("ETag") });
  } else {
    await deleteFile(file + META_SUFFIX);
  }
  onProgress({ loaded, total });

  const reader = response.body.getReader();
  try {
    // controlled infinite loop
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.byteLength;
      onProgress({ loaded, total });
    }
  } catch (err) {
    await writable.close().catch(() => {});
    throw err;
  }
  await writable.close();

  if (signal.aborted) return;

  const partFile = await partHandle.getFile();
  if (total != null && partFile.size < total) {
    throw new Error(
      "The download ended before the file was complete. Resume to continue.",
    );
  }
  if (total != null && partFile.size > total) {
    await deleteFile(partName);
    await deleteFile(file + META_SUFFIX);
    throw new Error(
      "The download was corrupted and has been discarded. Try downloading again.",
    );
  }

  const finalHandle = await getFileHandle(file, true);
  const finalWritable = await finalHandle.createWritable();
  await partFile.stream().pipeTo(finalWritable);
  await deleteFile(partName);
}

export async function getModelFile(model: Model): Promise<File | null> {
  const handle = await getFileHandle(MODELS[model].file, false);
  if (!handle) return null;
  const modelFile = await handle.getFile();
  const meta = await readMeta(MODELS[model].file);
  if (modelFile.size === 0 || (meta != null && modelFile.size !== meta.total)) {
    await deleteModel(model);
    return null;
  }
  return modelFile;
}
