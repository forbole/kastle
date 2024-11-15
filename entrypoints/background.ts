import { BackgroundService } from "@/api/background/background-service";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { MigrationManager } from "@/lib/migrations/migration";

export default defineBackground(() => {
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
