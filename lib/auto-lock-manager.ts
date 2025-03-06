import { Settings, SETTINGS_KEY } from "@/contexts/SettingsContext.tsx";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { storage } from "wxt/storage";

export const AUTO_LOCK_ALARM = "auto-lock-alarm";
export const KEEP_ALIVE_ALARM = "keep-alive";
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

export class AutoLockManager {
  constructor(private timeout: number = DEFAULT_AUTO_LOCK_MINUTES) {
    // Load settings from storage if settings are not loaded yet
    this.getLockTimeout().then((timeout) => {
      this.timeout = timeout;
    });
  }

  listen() {
    // start listeners
    browser.runtime.onConnect.addListener((port) => {
      if (port.name === "popup") {
        this.clearInactivityAlarm();

        port.onDisconnect.addListener(() => {
          this.resetInactivityAlarm();
        });
      }
    });

    // start an alarm to keep the extension alive
    browser.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });

    browser.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === AUTO_LOCK_ALARM) {
        await this.executeAutoLock();
      }
    });

    storage.watch(SETTINGS_KEY, async () => {
      const timeout = await this.getLockTimeout();
      if (this.timeout !== timeout) {
        this.timeout = timeout;
      }
    });
  }

  private async getLockTimeout() {
    const settings = await storage.getItem<Settings>(SETTINGS_KEY);
    return settings ? settings.lockTimeout : DEFAULT_AUTO_LOCK_MINUTES;
  }

  private resetInactivityAlarm() {
    browser.alarms.clear(AUTO_LOCK_ALARM, () => {
      browser.alarms.create(AUTO_LOCK_ALARM, {
        delayInMinutes: this.timeout,
      });
    });
  }

  private clearInactivityAlarm() {
    browser.alarms.clear(AUTO_LOCK_ALARM);
  }

  private executeAutoLock() {
    const extensionService = ExtensionService.getInstance();
    extensionService.getKeyring().lock();
    browser.alarms.clear(AUTO_LOCK_ALARM);
  }
}
