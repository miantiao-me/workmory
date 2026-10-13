import { defineHandler } from "nitro/h3";
import { handleAttachmentRequest } from "../../../../../http/attachment-handler";
import { runtimeFromNitroRequest, type NitroCloudflareRequest } from "../../../../../http/runtime";

export default defineHandler((event) => {
  const request = event.req as unknown as NitroCloudflareRequest;
  return handleAttachmentRequest(request, runtimeFromNitroRequest(request));
});
