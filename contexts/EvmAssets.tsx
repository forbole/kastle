import { ReactNode, createContext, SetStateAction } from "react";

export const EVM_ASSETS_KEY = "local:evmAssets";

export type WalletsEvmAssets = Record<string, EvmAssets>;

type EvmAssets = {
  erc20?: Erc20Asset[];
};

export type Erc20Asset = {
  address: string;
  symbol: string;
  decimals: number;
  image?: string; // Optional image URL
  chainId: string; // Chain ID to which this asset belongs
};

type EvmAssetsContextType = {
  evmAssets?: WalletsEvmAssets;
  isEvmAssetsLoading: boolean;
  saveEvmAssets: (
    newAsset: WalletsEvmAssets | ((prev: WalletsEvmAssets) => WalletsEvmAssets),
  ) => Promise<void>;
};

export const EvmAssetsContext = createContext<EvmAssetsContextType>({
  evmAssets: undefined,
  isEvmAssetsLoading: true,
  saveEvmAssets: () => Promise.resolve(),
});

export function EVMAssetsProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [evmAssets, setEvmAssets] = useState<WalletsEvmAssets>();

  useEffect(() => {
    const init = async () => {
      const evmAssets = await storage.getItem<WalletsEvmAssets>(EVM_ASSETS_KEY);

      if (evmAssets) {
        setEvmAssets(evmAssets);
      }

      setIsLoading(false);
    };

    init();

    const unwatch = storage.watch(
      EVM_ASSETS_KEY,
      (updatedAssets: WalletsEvmAssets | null) => {
        if (updatedAssets) {
          setEvmAssets(updatedAssets);
        }
      },
    );

    return () => unwatch();
  }, []);

  const saveEvmAssets = async (
    newAssets:
      | WalletsEvmAssets
      | ((prev: WalletsEvmAssets) => WalletsEvmAssets),
  ) => {
    const currentAssets =
      await storage.getItem<WalletsEvmAssets>(EVM_ASSETS_KEY);

    const updatedAssets =
      typeof newAssets === "function"
        ? newAssets(currentAssets || {})
        : newAssets;

    await storage.setItem(EVM_ASSETS_KEY, updatedAssets);
    setEvmAssets(updatedAssets);
  };

  return (
    <EvmAssetsContext.Provider
      value={{
        evmAssets,
        isEvmAssetsLoading: isLoading,
        saveEvmAssets,
      }}
    >
      {children}
    </EvmAssetsContext.Provider>
  );
}
