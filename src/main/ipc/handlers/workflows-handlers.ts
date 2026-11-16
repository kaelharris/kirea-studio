import { dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { isPathInsideWorkflowsDir, WorkflowImporter } from "../../workflows/workflow-importer";
import { WorkflowBrowser } from "../../workflows/workflow-browser";
import { WorkflowImportLedger } from "../../workflows/workflow-ledger";
import {
  CivitaiWorkflowIdSchema,
  CivitaiWorkflowImportSchema,
  CivitaiWorkflowSearchSchema,
  WorkflowImportInstallSchema,
  WorkflowImportRevealSchema,
  WorkflowImportUrlSchema,
  WorkflowInstalledFileSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

export function registerWorkflowsHandlers(
  ctx: HandlerContext,
  handle: IpcRegistrarHandle
): void {
  const ledger = new WorkflowImportLedger(
    path.join(ctx.paths.cacheDir, "workflow-import-ledger.json")
  );
  const importer = new WorkflowImporter({
    getSettings: ctx.getSettings,
    getModels: () => {
      const cached = ctx.getCachedModels();
      return cached.length > 0 ? cached : ctx.repo.listModels();
    },
    getConnectedApi: () =>
      ctx.runtime.getState().status === "connected"
        ? ctx.runtime.getApiClient()
        : null,
    getCivitaiApiKey: () => ctx.civitaiKeyStore.getKey(),
    cacheDir: ctx.paths.cacheDir,
    ledger,
  });
  const browser = new WorkflowBrowser({
    client: ctx.civitaiClient,
    importer,
    ledger,
  });

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_ANALYZE_URL, async (_event, urlRaw: unknown) => {
    const { url } = WorkflowImportUrlSchema.parse({ url: urlRaw });
    return importer.analyzeUrl(url);
  });

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_ANALYZE_FILE, async () => {
    const win = ctx.getMainWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Import ComfyUI Workflow",
      properties: ["openFile"],
      filters: [
        { name: "ComfyUI workflow JSON", extensions: ["json"] },
        { name: "Workflow ZIP archive", extensions: ["zip"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selected = result.filePaths[0]!;
    if (/\.zip$/i.test(selected)) {
      const preview = await importer.analyzeWorkflowArchiveFile(selected);
      return { kind: "archive" as const, preview };
    }
    const report = await importer.analyzeFile(selected);
    return { kind: "json" as const, report };
  });

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_ANALYZE_ARCHIVE_FILE, async () => {
    const win = ctx.getMainWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Import ComfyUI Workflow Archive",
      properties: ["openFile"],
      filters: [{ name: "Workflow ZIP archive", extensions: ["zip"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return importer.analyzeWorkflowArchiveFile(result.filePaths[0]!);
  });

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_INSTALL, async (_event, previewIdRaw: unknown) => {
    const { previewId } = WorkflowImportInstallSchema.parse({ previewId: previewIdRaw });
    return importer.install(previewId);
  });

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_LIST, () => importer.listInstalled());

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_REVEAL, async (_event, filePathRaw: unknown) => {
    const { filePath } = WorkflowImportRevealSchema.parse({ filePath: filePathRaw });
    const workflowsDir = importer.workflowsDir();
    if (!workflowsDir || !isPathInsideWorkflowsDir(filePath, workflowsDir)) {
      throw new Error("Blocked attempt to reveal a file outside ComfyUI's workflow folder.");
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error("That workflow file no longer exists on disk.");
    }
    shell.showItemInFolder(resolved);
  });

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_REMOVE, (_event, filePathRaw: unknown) => {
    const { filePath } = WorkflowInstalledFileSchema.parse({ filePath: filePathRaw });
    return importer.removeInstalled(filePath);
  });

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_REVALIDATE, (_event, filePathRaw: unknown) => {
    const { filePath } = WorkflowInstalledFileSchema.parse({ filePath: filePathRaw });
    return importer.revalidateInstalled(filePath);
  });

  handle(IPC_CHANNELS.WORKFLOW_IMPORT_REIMPORT, (_event, filePathRaw: unknown) => {
    const { filePath } = WorkflowInstalledFileSchema.parse({ filePath: filePathRaw });
    return importer.reimportInstalled(filePath);
  });

  // --- Civitai workflow browser ---
  handle(IPC_CHANNELS.CIVITAI_SEARCH_WORKFLOWS, async (_event, queryRaw: unknown) => {
    const parsed = CivitaiWorkflowSearchSchema.parse(queryRaw ?? {});
    const settings = ctx.getSettings();
    return browser.search({
      ...parsed,
      nsfw: settings.nsfwFilter ? false : parsed.nsfw === true,
    });
  });

  handle(IPC_CHANNELS.CIVITAI_GET_WORKFLOW_DETAILS, async (_event, modelIdRaw: unknown) => {
    const modelId = CivitaiWorkflowIdSchema.parse(modelIdRaw);
    return browser.details(modelId);
  });

  handle(
    IPC_CHANNELS.CIVITAI_PREPARE_WORKFLOW_IMPORT,
    async (_event, requestRaw: unknown) => {
      const request = CivitaiWorkflowImportSchema.parse(requestRaw);
      return browser.prepareImport(request);
    }
  );
}
