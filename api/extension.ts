import { ApiExtensionResponse } from "@/api/message";

export class ApiExtensionUtils {
  static sendMessage<T>(id: string, data: T) {
    return browser.runtime.sendMessage(new ApiExtensionResponse(id, data));
  }
}
