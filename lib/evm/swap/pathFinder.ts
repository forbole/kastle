import { PublicClient, Address, Abi } from "viem";
import { FACTORY_ABI, ZEALOUS_ROUTER_ABI, KASPA_COM_ROUTER_ABI } from "./utils";
import {
  SwapProvider,
  KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER,
  IGRA_MAINNET_KASPA_COM_SWAP_PROVIDER,
} from "./constants";

export interface PathQuoteResult {
  path: Address[];
  amountOut: bigint;
  amounts: bigint[];
  hops: number;
}

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export abstract class BasePathFinder {
  constructor(
    protected publicClient: PublicClient,
    protected factoryAddress: Address,
    protected routerAddress: Address,
    protected wkasAddress: Address,
  ) {}

  protected abstract get abi(): Abi;
  protected abstract getAmountsOutArgs(
    amountIn: bigint,
    path: Address[],
  ): unknown[];

  async pairExists(tokenA: Address, tokenB: Address): Promise<boolean> {
    try {
      const pair = await this.publicClient.readContract({
        address: this.factoryAddress,
        abi: FACTORY_ABI,
        functionName: "getPair",
        args: [tokenA, tokenB],
      });
      return pair !== "0x0000000000000000000000000000000000000000";
    } catch {
      return false;
    }
  }

  async getPathQuote(
    path: Address[],
    amountIn: bigint,
  ): Promise<{ path: Address[]; amountOut: bigint; amounts: bigint[] } | null> {
    try {
      const amounts = (await this.publicClient.readContract({
        address: this.routerAddress,
        abi: this.abi,
        functionName: "getAmountsOut",
        args: this.getAmountsOutArgs(amountIn, path),
      })) as bigint[];

      return {
        path,
        amountOut: amounts[amounts.length - 1],
        amounts: [...amounts],
      };
    } catch {
      return null;
    }
  }

  async findBestPath(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    options: { intermediateTokens?: Address[] } = {},
  ): Promise<PathQuoteResult> {
    const { intermediateTokens = [this.wkasAddress] } = options;
    const pathResults: PathQuoteResult[] = [];

    // Direct path
    if (await this.pairExists(tokenIn, tokenOut)) {
      const result = await this.getPathQuote([tokenIn, tokenOut], amountIn);
      if (result) pathResults.push({ ...result, hops: 1 });
    }

    // Paths via intermediate tokens
    for (const intermediate of intermediateTokens) {
      if (intermediate === tokenIn || intermediate === tokenOut) continue;

      const [hasIn, hasOut] = await Promise.all([
        this.pairExists(tokenIn, intermediate),
        this.pairExists(intermediate, tokenOut),
      ]);

      if (hasIn && hasOut) {
        const result = await this.getPathQuote(
          [tokenIn, intermediate, tokenOut],
          amountIn,
        );
        if (result) pathResults.push({ ...result, hops: 2 });
      }
    }

    if (pathResults.length === 0) throw new Error("No valid swap path found");

    return pathResults.sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1))[0];
  }
}

// ---------------------------------------------------------------------------
// ZealousPathFinder
// ---------------------------------------------------------------------------

export class ZealousPathFinder extends BasePathFinder {
  protected get abi(): Abi {
    return ZEALOUS_ROUTER_ABI as Abi;
  }

  protected getAmountsOutArgs(amountIn: bigint, path: Address[]): unknown[] {
    return [amountIn, path, false]; // isDiscountEligible = false
  }
}

// ---------------------------------------------------------------------------
// KaspaComPathFinder
// ---------------------------------------------------------------------------

export class KaspaComPathFinder extends BasePathFinder {
  protected get abi(): Abi {
    return KASPA_COM_ROUTER_ABI as Abi;
  }

  protected getAmountsOutArgs(amountIn: bigint, path: Address[]): unknown[] {
    return [amountIn, path];
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const KASPA_COM_ROUTER_ADDRESSES = [
  KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER.routerAddress.toLowerCase(),
  IGRA_MAINNET_KASPA_COM_SWAP_PROVIDER.routerAddress.toLowerCase(),
];

export function createPathFinder(
  provider: SwapProvider,
  publicClient: PublicClient,
  wkasAddress: Address,
): BasePathFinder {
  if (
    KASPA_COM_ROUTER_ADDRESSES.includes(provider.routerAddress.toLowerCase())
  ) {
    return new KaspaComPathFinder(
      publicClient,
      provider.factoryAddress,
      provider.routerAddress,
      wkasAddress,
    );
  }

  return new ZealousPathFinder(
    publicClient,
    provider.factoryAddress,
    provider.routerAddress,
    wkasAddress,
  );
}

// Keep PathFinder as an alias for backwards compatibility
export { BasePathFinder as PathFinder };
