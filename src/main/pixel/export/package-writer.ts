import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PixelPackageContainer } from "../../../shared/pixel-package-types";
import type { PixelboltModule } from "../pixel-engine";
import { readZip } from "./zip-reader";
import { PackageCancelledError } from "./package-builder";

export interface WritePackageOptions {
  engine: PixelboltModule;
  destination: string;
  container: PixelPackageContainer;
  root: string;
  signal?: AbortSignal;
}

export interface WrittenPackage {
  filePath: string;
  root: string;
  entries: Map<string, Buffer>;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PackageCancelledError();
}

async function uniqueRoot(destination: string, root: string, container: PixelPackageContainer): Promise<string> {
  const exists = async (name: string): Promise<boolean> => {
    const target = path.join(destination, container === "zip" ? `${name}.zip` : name);
    return fs
      .access(target)
      .then(() => true)
      .catch(() => false);
  };
  if (!(await exists(root))) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
}

export async function writePackage(
  files: Map<string, Buffer>,
  options: WritePackageOptions
): Promise<WrittenPackage> {
  const { engine, destination, container, signal } = options;
  await fs.mkdir(destination, { recursive: true });
  const root = await uniqueRoot(destination, options.root, container);
  const tempName = `.kirea-export-${randomUUID()}`;
  const tempPath = path.join(destination, container === "zip" ? `${tempName}.zip` : tempName);
  const finalPath = path.join(destination, container === "zip" ? `${root}.zip` : root);
  try {
    if (container === "zip") {
      const entries = new Map<string, Uint8Array>();
      for (const [relative, data] of files) {
        throwIfCancelled(signal);
        entries.set(`${root}/${relative}`, data);
      }
      throwIfCancelled(signal);
      const archive = engine.createZip(entries);
      await fs.writeFile(tempPath, archive, { flush: true });
    } else {
      await fs.mkdir(tempPath, { recursive: true });
      for (const [relative, data] of files) {
        throwIfCancelled(signal);
        const target = path.join(tempPath, ...relative.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, data, { flush: true });
      }
    }
    throwIfCancelled(signal);
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    await fs.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { filePath: finalPath, root, entries: await readPackage(finalPath, container, root) };
}

/** Reopens a written package and returns its files keyed by paths relative to the package root. */
export async function readPackage(
  filePath: string,
  container: PixelPackageContainer,
  root: string
): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  if (container === "zip") {
    const archive = await fs.readFile(filePath);
    const prefix = `${root}/`;
    for (const [name, data] of readZip(archive)) {
      if (!name.startsWith(prefix)) throw new Error(`The archive contains ${name}, which is outside ${root}/.`);
      entries.set(name.slice(prefix.length), data);
    }
    return entries;
  }
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const items = await fs.readdir(directory, { withFileTypes: true });
    for (const item of items) {
      const absolute = path.join(directory, item.name);
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(absolute, relative);
      else if (item.isFile()) entries.set(relative, await fs.readFile(absolute));
    }
  };
  await walk(filePath, "");
  return new Map([...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
