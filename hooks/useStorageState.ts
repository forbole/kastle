import { useEffect, useState } from "react";
import { StorageItemKey } from "@wxt-dev/storage";

function useStorageState<T>(key: StorageItemKey, initialValue: T) {
  const [value, setValue] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(true);

  const listenStorage = useCallback((updatedValue: T | null) => {
    if (updatedValue) {
      setValue(updatedValue);
    }
  }, []);

  useEffect(() => {
    storage.getItem(key, { fallback: initialValue }).then((storedValue) => {
      setValue(storedValue);
      setIsLoading(false);
    });

    const unwatch = storage.watch(key, listenStorage);

    return () => unwatch();
  }, [key]);

  const updateValue = async (newValue: T) => {
    if (isLoading) {
      return;
    }

    setValue(newValue);

    await storage.setItem(key, newValue);
  };

  return [value, updateValue, isLoading] as const;
}

export default useStorageState;
