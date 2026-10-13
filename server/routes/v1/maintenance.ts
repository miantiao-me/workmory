import { defineHandler } from "nitro/h3";
import { handleMaintenanceRequest } from "../../http/maintenance-handler";
import { runtimeFromNitroRequest, type NitroCloudflareRequest } from "../../http/runtime";

export default defineHandler((event) => {
  const request = event.req as unknown as NitroCloudflareRequest;
  return handleMaintenanceRequest(request, runtimeFromNitroRequest(request));
});
