import { defineHandler } from "nitro/h3";
import { handleProjectDirectoryRequest } from "../../../http/project-directory-handler";
import { runtimeFromNitroRequest, type NitroCloudflareRequest } from "../../../http/runtime";

export default defineHandler((event) => {
  const request = event.req as unknown as NitroCloudflareRequest;
  return handleProjectDirectoryRequest(request, runtimeFromNitroRequest(request));
});
