import { ExtensionService } from "@/lib/service/extension-service";

export function isKeyringInitialized(): Promise<boolean> {
  return ExtensionService.getInstance().getKeyring().isInitialized();
}
