import { useEffect, useState } from "react";
import { StorageItemKey } from "@wxt-dev/storage";
import { updateWalletSettingsLocked, WALLET_SETTINGS_STORAGE_KEY } from "@/lib/wallet-settings-storage";

function useStorageState<T>(key: StorageItemKey, initialValue: T) {
  const [snapshot, setSnapshot] = useState({ value: initialValue, baselineJson: key === WALLET_SETTINGS_STORAGE_KEY ? JSON.stringify(initialValue) : "" });
  const value = snapshot.value;
  const [isLoading, setIsLoading] = useState(true);

  const listenStorage = useCallback((updatedValue: T | null) => {
    if (updatedValue !== null) {
      setSnapshot({ value: updatedValue, baselineJson: key === WALLET_SETTINGS_STORAGE_KEY ? JSON.stringify(updatedValue) : "" });
    }
  }, [key]);

  useEffect(() => {
    storage.getItem(key, { fallback: initialValue }).then((storedValue) => {
      setSnapshot({ value: storedValue, baselineJson: key === WALLET_SETTINGS_STORAGE_KEY ? JSON.stringify(storedValue) : "" });
      setIsLoading(false);
    });

    const unwatch = storage.watch(key, listenStorage);

    return () => unwatch();
  }, [key]);

  const updateValue = async (newValue: T | ((prev: T) => T | Promise<T>)) => {
    if (isLoading) {
      return;
    }

    if (key === WALLET_SETTINGS_STORAGE_KEY) {
      try {
        const next = await updateWalletSettingsLocked<T>(key,
          (current) => typeof newValue === "function"
            ? (newValue as (prev: T) => T | Promise<T>)(current)
            : newValue,
          { expectedJson: typeof newValue === "function" ? undefined : snapshot.baselineJson, fallback: initialValue },
        );
        setSnapshot({ value: next, baselineJson: JSON.stringify(next) });
      } catch (cause) {
        const latest = await storage.getItem(key, { fallback: initialValue });
        setSnapshot({ value: latest, baselineJson: JSON.stringify(latest) });
        throw cause;
      }
      return;
    }

    const valueToStore = typeof newValue === "function"
      ? await (newValue as (prev: T) => T | Promise<T>)(value)
      : newValue;
    await storage.setItem(key, valueToStore);
  };

  return [value, updateValue, isLoading] as const;
}

export default useStorageState;
