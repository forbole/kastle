import { ReactNode, createContext } from "react";

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
  walletsAssets?: WalletsEvmAssets;
  isEvmAssetsLoading: boolean;
};

export const EvmAssetsContext = createContext<EvmAssetsContextType>({
  walletsAssets: undefined,
  isEvmAssetsLoading: true,
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

  return (
    <EvmAssetsContext.Provider
      value={{
        walletsAssets: evmAssets,
        isEvmAssetsLoading: isLoading,
      }}
    >
      {children}
    </EvmAssetsContext.Provider>
  );
}
