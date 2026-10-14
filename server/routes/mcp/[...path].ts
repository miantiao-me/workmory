import { defineHandler } from "nitro/h3";
import { handleMcpRequest } from "../../http/mcp-handler";
import { runtimeFromNitroRequest, type NitroCloudflareRequest } from "../../http/runtime";

export default defineHandler((event) => {
  const request = event.req as unknown as NitroCloudflareRequest;
  return handleMcpRequest(request, runtimeFromNitroRequest(request));
});
