import { MODELS, type Model } from "@/lib/registry";

const PART_SUFFIX = ".part";
const META_SUFFIX = ".meta";

let modelsDirPromise: Promise<FileSystemDirectoryHandle> | null = null;

function getModelsDir(): Promise<FileSystemDirectoryHandle> {
  modelsDirPromise ??= navigator.storage
    .getDirectory()
    .then((root) => root.getDirectoryHandle("models", { create: true }))
    .catch((err: unknown) => {
      modelsDirPromise = null;
      throw err;
    });
  return modelsDirPromise;
}

async function createFileHandle(
  fileName: string,
): Promise<FileSystemFileHandle> {
  const dir = await getModelsDir();
  return dir.getFileHandle(fileName, { create: true });
}

async function findFileHandle(
  fileName: string,
): Promise<FileSystemFileHandle | null> {
  const dir = await getModelsDir();
  try {
    return await dir.getFileHandle(fileName, { create: false });
  } catch {
    return null;
  }
}

async function getFileSize(fileName: string): Promise<number> {
  const handle = await findFileHandle(fileName);
  if (!handle) return 0;
  const file = await handle.getFile();
  return file.size;
}

async function deleteFile(fileName: string): Promise<void> {
  const dir = await getModelsDir();
  await dir.removeEntry(fileName).catch(() => {});
}

async function discardPartialDownload(file: string): Promise<void> {
  await Promise.all([
    deleteFile(file + PART_SUFFIX),
    deleteFile(file + META_SUFFIX),
  ]);
}

type ModelMeta = {
  size: number;
  etag: string | null;
};

async function writeMeta(file: string, meta: ModelMeta): Promise<void> {
  const handle = await createFileHandle(file + META_SUFFIX);
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

async function readMeta(file: string): Promise<ModelMeta | null> {
  const handle = await findFileHandle(file + META_SUFFIX);
  if (!handle) return null;
  const text = await (await handle.getFile()).text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const meta = parsed as Partial<ModelMeta>;
    const total = Number(meta.size);
    const etag = typeof meta.etag === "string" ? meta.etag : null;
    return Number.isFinite(total) && total > 0 ? { size: total, etag } : null;
  } catch {
    return null;
  }
}

function isValidModelFile(file: File, meta: ModelMeta | null): boolean {
  return file.size > 0 && (meta == null || file.size === meta.size);
}

async function isModelCached(model: Model): Promise<boolean> {
  const handle = await findFileHandle(MODELS[model].file);
  if (!handle) return false;
  const [file, meta] = await Promise.all([
    handle.getFile(),
    readMeta(MODELS[model].file),
  ]);
  return isValidModelFile(file, meta);
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
    return { status: "paused", loaded: partSize, total: meta?.size ?? null };
  }
  if (await isModelCached(model)) return { status: "cached" };
  return { status: "idle" };
}

export async function deleteModel(model: Model): Promise<void> {
  const { file } = MODELS[model];
  await Promise.all([deleteFile(file), discardPartialDownload(file)]);
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

  const partHandle = await createFileHandle(partName);
  const startOffset = (await partHandle.getFile()).size;

  const headers: Record<string, string> = {};
  if (startOffset > 0) {
    headers.Range = `bytes=${startOffset}-`;
    const etag = (await readMeta(file))?.etag;
    if (etag) headers["If-Range"] = etag;
  }

  const response = await fetch(url, { signal, headers });

  if (response.status === 416) {
    await discardPartialDownload(file);
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
    await writeMeta(file, { size: total, etag: response.headers.get("ETag") });
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
      "The download ended before the file was complete. Try downloading again to continue.",
    );
  }
  if (total != null && partFile.size > total) {
    await discardPartialDownload(file);
    throw new Error(
      "The download was corrupted and has been discarded. Try downloading again.",
    );
  }

  const finalHandle = await createFileHandle(file);
  const finalWritable = await finalHandle.createWritable();
  await partFile.stream().pipeTo(finalWritable);
  await deleteFile(partName);
}

export async function getModelFile(model: Model): Promise<File | null> {
  const handle = await findFileHandle(MODELS[model].file);
  if (!handle) return null;
  const [modelFile, meta] = await Promise.all([
    handle.getFile(),
    readMeta(MODELS[model].file),
  ]);
  return isValidModelFile(modelFile, meta) ? modelFile : null;
}
