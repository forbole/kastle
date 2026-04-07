import { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";

/** getVersion handler to serve Action.GET_VERSION message */
export const getVersionHandler: Handler = async (
  _tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
  const manifest = browser.runtime.getManifest();
  const version = `${manifest.version}+extension`;

  sendResponse(ApiUtils.createApiResponse(message.id, version));
};
