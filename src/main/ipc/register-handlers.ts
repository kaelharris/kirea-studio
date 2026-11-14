import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { isTrustedIpcSender } from "../security";
import { registerAppRuntimeHandlers } from "./handlers/app-runtime-handlers";
import { registerGenerationHandlers } from "./handlers/generation-handlers";
import { registerModelsHandlers } from "./handlers/models-handlers";
import { registerStoriesHandlers } from "./handlers/stories-handlers";
import type { HandlerContext, IpcRegistrarHandle } from "./schemas";

export type { HandlerContext } from "./schemas";

export function registerIpcHandlers(ctx: HandlerContext): void {
  const handle: IpcRegistrarHandle = <Args extends unknown[], Result>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
  ): void => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (
        !isTrustedIpcSender(
          event,
          ctx.getMainWindow(),
          ctx.expectedHtmlPath,
          ctx.devServerOrigin
        )
      ) {
        throw new Error(`Untrusted IPC sender rejected for ${channel}`);
      }
      return await fn(event, ...(args as Args));
    });
  };

  registerAppRuntimeHandlers(ctx, handle);
  registerModelsHandlers(ctx, handle);
  registerStoriesHandlers(ctx, handle);
  registerGenerationHandlers(ctx, handle);
}
