import { z } from "zod";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import {
  UpdateChannelSchema,
  type HandlerContext,
  type IpcRegistrarHandle,
} from "../schemas";

const ForceInstallSchema = z.boolean().optional();

export function registerUpdateHandlers(
  ctx: HandlerContext,
  handle: IpcRegistrarHandle
): void {
  handle(IPC_CHANNELS.UPDATE_GET_STATE, () => ctx.updateService.getState());
  handle(IPC_CHANNELS.UPDATE_CHECK, () => ctx.updateService.checkForUpdates(true));
  handle(IPC_CHANNELS.UPDATE_DOWNLOAD, () => ctx.updateService.downloadUpdate());
  handle(IPC_CHANNELS.UPDATE_CANCEL_DOWNLOAD, () => ctx.updateService.cancelDownload());
  handle(IPC_CHANNELS.UPDATE_DISMISS, () => ctx.updateService.dismissUpdate());
  handle(IPC_CHANNELS.UPDATE_SET_CHANNEL, (_event, channelRaw: unknown) =>
    ctx.updateService.setChannel(UpdateChannelSchema.parse(channelRaw))
  );
  handle(IPC_CHANNELS.UPDATE_INSTALL, (_event, forceRaw: unknown) =>
    ctx.updateService.installUpdate(ForceInstallSchema.parse(forceRaw) ?? false)
  );
}
