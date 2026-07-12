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

async function writeTotalSize(file: string, total: number): Promise<void> {
  const handle = await getFileHandle(file + META_SUFFIX, true);
  const writable = await handle.createWritable();
  await writable.write(String(total));
  await writable.close();
}

async function readTotalSize(file: string): Promise<number | null> {
  const handle = await getFileHandle(file + META_SUFFIX, false);
  if (!handle) return null;
  const text = await (await handle.getFile()).text();
  const total = Number(text);
  return Number.isFinite(total) && total > 0 ? total : null;
}

export async function isModelCached(model: Model): Promise<boolean> {
  const handle = await getFileHandle(MODELS[model].file, false);
  if (!handle) return false;
  const file = await handle.getFile();
  return file.size > 0;
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
    const total = await readTotalSize(file);
    return { status: "paused", loaded: partSize, total };
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

  const headers: HeadersInit =
    startOffset > 0 ? { Range: `bytes=${startOffset}-` } : {};

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
  if (total != null) await writeTotalSize(file, total);
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

  const finalHandle = await getFileHandle(file, true);
  const finalWritable = await finalHandle.createWritable();
  const partFile = await partHandle.getFile();
  await partFile.stream().pipeTo(finalWritable);
  await deleteFile(partName);
  await deleteFile(file + META_SUFFIX);
}

export async function getModelFile(model: Model): Promise<File | null> {
  const handle = await getFileHandle(MODELS[model].file, false);
  if (!handle) return null;
  return handle.getFile();
}
