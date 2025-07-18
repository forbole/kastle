import { ApiExtensionResponseSchema } from "@/api/message";

function createApiResponse<T>(id: string, response: T) {
  return ApiExtensionResponseSchema.parse({
    source: "extension",
    target: "background",
    id,
    response,
  });
}

export class ApiExtensionUtils {
  static sendMessage<T>(id: string, data: T) {
    return browser.runtime.sendMessage(createApiResponse(id, data));
  }
}
