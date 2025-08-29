import { BackgroundService } from "@/api/background/background-service";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { MigrationManager } from "@/lib/migrations/migration";
import init from "@/wasm/core/kaspa";
import kaspaModule from "@/assets/kaspa_bg.wasm?url";

export default defineBackground(() => {
  init(kaspaModule).catch((error) => {
    console.error("Failed to initialize the Kaspa module:", error);
  });

  new BackgroundService().listen();
  ExtensionService.getInstance().startListening();

  browser.runtime.onInstalled.addListener(
    async ({ reason, previousVersion }) => {
      if (reason !== "update") {
        return;
      }

      await new MigrationManager().run(previousVersion ?? "0.0.0");
    },
  );
});
