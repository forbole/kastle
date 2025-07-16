import { ApiExtensionResponseSchema } from "@/api/message";

function createApiResponse(id: string, response: unknown) {
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
