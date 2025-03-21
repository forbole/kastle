import { Settings, SETTINGS_KEY } from "@/contexts/SettingsContext.tsx";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { storage } from "wxt/storage";

export const AUTO_LOCK_ALARM = "auto-lock-alarm";
export const DEFAULT_AUTO_LOCK_MINUTES = 5;
const MAX_AUTO_LOCK_MINUTES = 60;
const KEEP_ALIVE_INTERVAL = 25 * 1000;
const KEEP_ALIVE_KEY = "local:keep-alive";

export class AutoLockManager {
  keepAlive: NodeJS.Timeout | undefined;

  constructor(private timeout: number = DEFAULT_AUTO_LOCK_MINUTES) {
    // Load settings from storage if settings are not loaded yet
    this.getLockTimeout().then((timeout) => {
      this.timeout = timeout;
    });
  }

  listen() {
    // start listeners
    browser.runtime.onConnect.addListener(async (port) => {
      if (port.name === "popup") {
        await this.clearInactivityAlarm();

        port.onDisconnect.addListener(() => {
          // Keep alive until the keyring is locked (max 60 minutes)
          this.startKeepAlive();
          this.resetInactivityAlarm();
        });
      }
    });

    browser.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === AUTO_LOCK_ALARM) {
        await this.executeAutoLock();

        // Stop keep alive after the keyring is locked
        this.stopKeepAlive();
      }
    });

    storage.watch(SETTINGS_KEY, async () => {
      let timeout = await this.getLockTimeout();
      // Limit the maximum auto lock time to 60 minutes
      if (timeout > MAX_AUTO_LOCK_MINUTES) timeout = MAX_AUTO_LOCK_MINUTES;

      if (this.timeout !== timeout) {
        this.timeout = timeout;
      }
    });
  }

  private startKeepAlive() {
    if (this.keepAlive) clearInterval(this.keepAlive);

    this.keepAlive = setInterval(async () => {
      await chrome.runtime.getPlatformInfo();
      await storage.setItem(KEEP_ALIVE_KEY, Date.now());
    }, KEEP_ALIVE_INTERVAL);
  }

  private stopKeepAlive() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
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

  private async clearInactivityAlarm() {
    await browser.alarms.clear(AUTO_LOCK_ALARM);
  }

  private async executeAutoLock() {
    const extensionService = ExtensionService.getInstance();
    extensionService.getKeyring().lock();
    await browser.alarms.clear(AUTO_LOCK_ALARM);
  }
}
