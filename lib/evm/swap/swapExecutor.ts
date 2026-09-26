import {
  erc20Abi,
  PublicClient,
  WalletClient,
  Address,
  Abi,
  encodeFunctionData,
} from "viem";
import {
  encodeWithPartnerKey,
  ZEALOUS_ROUTER_ABI,
  KASPA_COM_ROUTER_ABI,
  FEE_COLLECTOR_SWAP_ABI,
} from "./utils";
import {
  SwapProvider,
  KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER,
  IGRA_MAINNET_KASPA_COM_SWAP_PROVIDER,
  KASPA_COM_PARTNER_KEY,
} from "./constants";

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export abstract class BaseSwapExecutor {
  constructor(
    protected publicClient: PublicClient,
    protected walletClient: WalletClient,
    protected routerAddress: Address,
    protected wkasAddress: Address,
    protected gasPrice?: bigint,
  ) {}

  /** ABI used for encoding and reading */
  protected abstract get abi(): Abi;

  /** Contract that receives swap transactions */
  protected abstract get swapTarget(): Address;

  /** Spender address for ERC20 approve() */
  protected abstract get approvalSpender(): Address;

  /**
   * Recipient of output tokens in swap calldata.
   * Defaults to swapTarget; override for contracts that require the user's address.
   */
  protected get recipientAddress(): Address {
    return this.swapTarget;
  }

  /** Build args for getAmountsOut call */
  protected abstract getAmountsOutArgs(
    amountIn: bigint,
    path: Address[],
  ): unknown[];

  /** Encode swap calldata (may append partner suffix) */
  protected abstract encodeSwapData(
    functionName: string,
    args: unknown[],
  ): `0x${string}`;

  /** Name of the KAS→ERC20 swap function */
  protected abstract get kasToTokenFnName(): string;

  /** Name of the ERC20→KAS swap function */
  protected abstract get tokensToKasFnName(): string;

  // ---- Shared utilities ----

  async ensureApproval(
    tokenAddress: Address,
    amount: bigint,
    ownerAddress: Address,
  ) {
    if (!this.walletClient.account)
      throw new Error("Wallet client account address is undefined");
    if (!this.walletClient.chain)
      throw new Error("Wallet client chain is not set");

    const allowance = await this.publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ownerAddress, this.approvalSpender],
    });

    if (allowance < amount) {
      const hash = await this.walletClient.writeContract({
        account: this.walletClient.account,
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [this.approvalSpender, amount],
        chain: this.walletClient.chain,
        gasPrice: this.gasPrice,
      });
      await this.publicClient.waitForTransactionReceipt({ hash });
    }
  }

  /**
   * Refuses to submit when the swap target has no code on the chain the
   * clients are built for. A call to a codeless address does not revert — it
   * succeeds, burns gas, executes no calldata, and KEEPS any native value
   * attached. The incident report attributes a 25 iKAS loss (tx 0x7ba03228…,
   * 2026-08-20) to exactly that, a stale form provider aiming Kasplex's fee
   * collector at an Igra wallet client; the loss figure is from the report,
   * while the codeless-collector half is chain-checked (eth_getCode for
   * 0xdfa17269… on Igra answers "0x", 2026-08-25). The provider re-resolution in useSwap.ts stops that
   * instance; this stops the class, whatever hands the executor its addresses.
   *
   * Fails CLOSED: an unreadable answer (RPC error) refuses the swap too — not
   * knowing whether the target exists is not a reason to send money at it.
   * Every swap method calls this before its first transaction, approval
   * included, since approvalSpender is the same contract in every executor
   * this file defines.
   */
  protected async assertSwapTargetHasCode(): Promise<void> {
    // viem's getCode answers undefined for a codeless address (it maps the
    // node's "0x" to undefined); "0x" is checked too so a raw response cannot
    // slip through as truthy.
    const code = await this.publicClient.getCode({ address: this.swapTarget });
    if (!code || code === "0x") {
      throw new Error(
        `Swap target ${this.swapTarget} has no contract code on chain ` +
          `${this.publicClient.chain?.id ?? "unknown"} — refusing to submit`,
      );
    }
  }

  getDeadline() {
    return BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
  }

  calculateMinAmount(amount: bigint, slippagePercent = 0.5): bigint {
    return (
      (amount * BigInt(Math.floor((100 - slippagePercent) * 100))) / 10000n
    );
  }

  protected async readAmountsOut(
    amountIn: bigint,
    path: Address[],
  ): Promise<bigint[]> {
    return (await this.publicClient.readContract({
      address: this.routerAddress,
      abi: this.abi,
      functionName: "getAmountsOut",
      args: this.getAmountsOutArgs(amountIn, path),
    })) as bigint[];
  }

  // ---- Swap methods (implemented once using abstract hooks) ----

  async swapKASForTokens(amountIn: bigint, path: Address[], slippage = 0.5) {
    if (!this.walletClient.account)
      throw new Error("Wallet client account address is undefined");
    if (path[0] !== this.wkasAddress)
      throw new Error("The first address in the path must be WKAS");

    await this.assertSwapTargetHasCode();

    const amounts = await this.readAmountsOut(amountIn, path);
    const amountOutMin = this.calculateMinAmount(
      amounts[amounts.length - 1],
      slippage,
    );
    const deadline = this.getDeadline();

    const data = this.encodeSwapData(this.kasToTokenFnName, [
      amountOutMin,
      path,
      this.recipientAddress,
      deadline,
    ]);

    const hash = await this.walletClient.sendTransaction({
      account: this.walletClient.account,
      to: this.swapTarget,
      data,
      value: amountIn,
      chain: this.walletClient.chain,
      gasPrice: this.gasPrice,
    });

    return this.publicClient.waitForTransactionReceipt({ hash });
  }

  async swapTokensForKAS(
    tokenAddress: Address,
    amountIn: bigint,
    path: Address[],
    slippage = 0.5,
    onApprovalFinished?: () => void,
  ) {
    if (!this.walletClient.account)
      throw new Error("Wallet client account address is undefined");
    if (path[path.length - 1] !== this.wkasAddress)
      throw new Error("The last address in the path must be WKAS");

    // Before the approval, not just the swap: the spender is the same
    // contract, and an approval granted to a codeless address is gas spent
    // preparing a swap this method would then refuse.
    await this.assertSwapTargetHasCode();

    await this.ensureApproval(
      tokenAddress,
      amountIn,
      this.walletClient.account.address,
    );
    onApprovalFinished?.();

    const amounts = await this.readAmountsOut(amountIn, path);
    const amountOutMin = this.calculateMinAmount(
      amounts[amounts.length - 1],
      slippage,
    );
    const deadline = this.getDeadline();

    const data = this.encodeSwapData(this.tokensToKasFnName, [
      amountIn,
      amountOutMin,
      path,
      this.recipientAddress,
      deadline,
    ]);

    return this.walletClient.sendTransaction({
      account: this.walletClient.account,
      to: this.swapTarget,
      data,
      chain: this.walletClient.chain,
      gasPrice: this.gasPrice,
    });
  }

  async swapTokensForTokens(
    tokenInAddress: Address,
    amountIn: bigint,
    path: Address[],
    slippage = 0.5,
    onApprovalFinished?: () => void,
  ) {
    if (!this.walletClient.account)
      throw new Error("Wallet client account address is undefined");

    await this.assertSwapTargetHasCode();

    await this.ensureApproval(
      tokenInAddress,
      amountIn,
      this.walletClient.account.address,
    );
    onApprovalFinished?.();

    const amounts = await this.readAmountsOut(amountIn, path);
    const amountOutMin = this.calculateMinAmount(
      amounts[amounts.length - 1],
      slippage,
    );
    const deadline = this.getDeadline();

    const data = this.encodeSwapData("swapExactTokensForTokens", [
      amountIn,
      amountOutMin,
      path,
      this.recipientAddress,
      deadline,
    ]);

    return this.walletClient.sendTransaction({
      account: this.walletClient.account,
      to: this.swapTarget,
      data,
      chain: this.walletClient.chain,
      gasPrice: this.gasPrice,
    });
  }
}

// ---------------------------------------------------------------------------
// ZealousSwapExecutor
// ---------------------------------------------------------------------------

export class ZealousSwapExecutor extends BaseSwapExecutor {
  protected get abi(): Abi {
    return ZEALOUS_ROUTER_ABI as Abi;
  }
  protected get swapTarget(): Address {
    return this.routerAddress;
  }
  protected get approvalSpender(): Address {
    return this.routerAddress;
  }
  protected get kasToTokenFnName() {
    return "swapExactKASForTokens";
  }
  protected get tokensToKasFnName() {
    return "swapExactTokensForKAS";
  }

  protected getAmountsOutArgs(amountIn: bigint, path: Address[]): unknown[] {
    return [amountIn, path, false]; // isDiscountEligible = false
  }

  protected encodeSwapData(
    functionName: string,
    args: unknown[],
  ): `0x${string}` {
    return encodeFunctionData({
      abi: this.abi,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]);
  }
}

// ---------------------------------------------------------------------------
// KaspaComSwapExecutor
// ---------------------------------------------------------------------------

export class KaspaComSwapExecutor extends BaseSwapExecutor {
  constructor(
    publicClient: PublicClient,
    walletClient: WalletClient,
    routerAddress: Address,
    wkasAddress: Address,
    gasPrice: bigint | undefined,
    private proxyAddress: Address,
    private partnerKey: `0x${string}`,
  ) {
    super(publicClient, walletClient, routerAddress, wkasAddress, gasPrice);
  }

  protected get abi(): Abi {
    return KASPA_COM_ROUTER_ABI as Abi;
  }
  protected get swapTarget(): Address {
    return this.proxyAddress;
  }
  protected get approvalSpender(): Address {
    return this.proxyAddress;
  }
  protected get kasToTokenFnName() {
    return "swapExactETHForTokens";
  }
  protected get tokensToKasFnName() {
    return "swapExactTokensForETH";
  }

  protected getAmountsOutArgs(amountIn: bigint, path: Address[]): unknown[] {
    return [amountIn, path];
  }

  protected encodeSwapData(
    functionName: string,
    args: unknown[],
  ): `0x${string}` {
    const data = encodeFunctionData({
      abi: this.abi,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]);
    return encodeWithPartnerKey(data, this.partnerKey);
  }
}

// ---------------------------------------------------------------------------
// FeeCollectorSwapExecutor
// ---------------------------------------------------------------------------

/**
 * Routes Zealous swaps through the FeeCollector contract.
 * Quotes still use the underlying Zealous Router (getAmountsOut).
 * Swap transactions target the FeeCollector; output tokens go to the user.
 */
export class FeeCollectorSwapExecutor extends BaseSwapExecutor {
  constructor(
    publicClient: PublicClient,
    walletClient: WalletClient,
    routerAddress: Address, // Zealous Router — used for getAmountsOut
    wkasAddress: Address,
    gasPrice: bigint | undefined,
    private feeCollectorAddress: Address,
  ) {
    super(publicClient, walletClient, routerAddress, wkasAddress, gasPrice);
  }

  protected get abi(): Abi {
    return ZEALOUS_ROUTER_ABI as Abi; // used for readAmountsOut
  }
  protected get swapTarget(): Address {
    return this.feeCollectorAddress;
  }
  protected get approvalSpender(): Address {
    return this.feeCollectorAddress;
  }
  /** Output tokens go to the caller's wallet, not the contract. */
  protected get recipientAddress(): Address {
    return this.walletClient.account?.address as Address;
  }
  protected get kasToTokenFnName() {
    return "swapExactKASForTokens";
  }
  protected get tokensToKasFnName() {
    return "swapExactTokensForKAS";
  }

  protected getAmountsOutArgs(amountIn: bigint, path: Address[]): unknown[] {
    return [amountIn, path, false]; // isDiscountEligible = false for Zealous Router
  }

  protected override async readAmountsOut(
    amountIn: bigint,
    path: Address[],
  ): Promise<bigint[]> {
    // Fee collector deducts feeRate bps before forwarding to the router.
    // Adjust amountIn so the quote reflects what the router actually receives.
    let feeCollectorBps = 75n; // fallback
    try {
      feeCollectorBps = (await this.publicClient.readContract({
        address: this.feeCollectorAddress,
        abi: FEE_COLLECTOR_SWAP_ABI,
        functionName: "feeRate",
      })) as bigint;
    } catch {
      // ignore — use fallback
    }
    const adjustedAmountIn = (amountIn * (10_000n - feeCollectorBps)) / 10_000n;
    return super.readAmountsOut(adjustedAmountIn, path);
  }

  protected encodeSwapData(
    functionName: string,
    args: unknown[],
  ): `0x${string}` {
    return encodeFunctionData({
      abi: FEE_COLLECTOR_SWAP_ABI,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const KASPA_COM_ROUTER_ADDRESSES = [
  KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER.routerAddress.toLowerCase(),
  IGRA_MAINNET_KASPA_COM_SWAP_PROVIDER.routerAddress.toLowerCase(),
];

export function createSwapExecutor(
  provider: SwapProvider,
  publicClient: PublicClient,
  walletClient: WalletClient,
  wkasAddress: Address,
  gasPrice?: bigint,
): BaseSwapExecutor {
  if (
    KASPA_COM_ROUTER_ADDRESSES.includes(provider.routerAddress.toLowerCase()) &&
    provider.proxyAddress
  ) {
    return new KaspaComSwapExecutor(
      publicClient,
      walletClient,
      provider.routerAddress,
      wkasAddress,
      gasPrice,
      provider.proxyAddress,
      KASPA_COM_PARTNER_KEY,
    );
  }

  if (provider.feeCollectorAddress) {
    return new FeeCollectorSwapExecutor(
      publicClient,
      walletClient,
      provider.routerAddress,
      wkasAddress,
      gasPrice,
      provider.feeCollectorAddress,
    );
  }

  return new ZealousSwapExecutor(
    publicClient,
    walletClient,
    provider.routerAddress,
    wkasAddress,
    gasPrice,
  );
}
