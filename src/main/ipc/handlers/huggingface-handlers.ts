import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import {
  HuggingFaceCompatibilityRequestSchema,
  HuggingFaceRepoRequestSchema,
  HuggingFaceSearchSchema,
  HuggingFaceStartRequestSchema,
  HuggingFaceTokenSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

export function registerHuggingFaceHandlers(
  ctx: HandlerContext,
  handle: IpcRegistrarHandle
): void {
  handle(IPC_CHANNELS.HUGGINGFACE_SEARCH, async (_event, queryRaw: unknown) => {
    const query = HuggingFaceSearchSchema.parse(queryRaw ?? {});
    return ctx.huggingFaceService.search(query);
  });

  handle(IPC_CHANNELS.HUGGINGFACE_GET_REPO, async (_event, requestRaw: unknown) => {
    const request = HuggingFaceRepoRequestSchema.parse(requestRaw);
    return ctx.huggingFaceService.getRepo(request.repoId, request.revision);
  });

  handle(
    IPC_CHANNELS.HUGGINGFACE_CHECK_COMPATIBILITY,
    async (_event, requestRaw: unknown) => {
      const request = HuggingFaceCompatibilityRequestSchema.parse(requestRaw);
      return ctx.huggingFaceService.checkCompatibility(request);
    }
  );

  handle(IPC_CHANNELS.HUGGINGFACE_START_DOWNLOADS, async (_event, requestRaw: unknown) => {
    const request = HuggingFaceStartRequestSchema.parse(requestRaw);
    return ctx.huggingFaceService.startDownloads(request);
  });

  handle(IPC_CHANNELS.HUGGINGFACE_SET_TOKEN, (_event, tokenRaw: unknown) => {
    const token = HuggingFaceTokenSchema.parse(tokenRaw);
    const hasToken = ctx.huggingFaceTokenStore.setToken(token);
    ctx.setSettings({ ...ctx.getSettings(), huggingfaceTokenSet: hasToken });
    return { hasToken };
  });

  handle(IPC_CHANNELS.HUGGINGFACE_TEST_CONNECTION, () =>
    ctx.huggingFaceService.testConnection()
  );
}
