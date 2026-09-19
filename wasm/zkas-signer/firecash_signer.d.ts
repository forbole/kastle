/* tslint:disable */
/* eslint-disable */
/**
 * Derive the `zkas:` address for an existing seed on a network.
 */
export function address_from_seed(seed_hex: string, network: string): string;
/**
 * **The anti-blind-signing entry point** for the non-custodial send.
 *
 * Given the server's `prepare` response, this VERIFIES on the device — using only the
 * wallet's own viewing key — that the unsigned `bundle_hex` really pays `to` the amount
 * `amount_sompi`, with any other output being change back to this wallet, and that the
 * fee the bundle actually pays (its public value balance — **never** a number the
 * server reported) is positive and at most `max_fee_sompi`. Without that ceiling a
 * malicious daemon could burn the wallet's entire change as "fee" — collectable by a
 * miner, plausibly the daemon's own pool — while every commitment check still passed.
 * Only if all of that holds does it recompute the sighash **from the verified bundle
 * itself** (never trusting a server-supplied hash or network domain) and return
 * the RedPallas spend-auth signatures.
 *
 * `disclosure_json` is the `disclosure` array from `prepare`, `alphas_json` its
 * `spend_auth` array (`[{index, alpha}]`). A malicious server cannot get a signature
 * for anything but the payment the user asked for: any lie fails a note or value
 * commitment here, and a bundle that dodges the checks won't match the sighash this
 * function signs. Returns `[{index, sig}]` JSON on success, or throws with the reason.
 */
export function verify_and_sign_payment(seed_hex: string, network: string, to_address: string, amount_sompi: bigint, max_fee_sompi: bigint, bundle_hex: string, disclosure_json: string, alphas_json: string): string;
/**
 * Sign `message`, proving control of the seed's address on `network`. The
 * returned `signature_hex` is `fvk ‖ sig`, interoperable with `shielded-pay` and
 * the mining-pool claim verifier.
 */
export function sign(seed_hex: string, network: string, message: string): Signature;
/**
 * The wallet's full viewing key (`ak ‖ nk ‖ rivk`, 96 bytes) as hex, derived from
 * the seed on-device. Send this to the daemon's non-custodial `/prepare` endpoint so
 * it can scan watch-only and build the payment proof. Grants viewing, not spend.
 */
export function fvk_hex(seed_hex: string): string;
/**
 * Derive the spending key of ONE ACCOUNT from a recovery phrase, as 64-hex.
 *
 * This is what makes one phrase back up many wallets. ZIP-32 gives every account
 * index its own independent key under `m/32'/coin'/account'`, so account 0, 1, 2…
 * are unlinkable on-chain yet all restore from the same twelve words. The result
 * is a plain 32-byte secret, so every existing path — address, viewing key,
 * signing, spending — consumes it unchanged.
 *
 * Account 0 is the wallet the phrase creates by default; `add account` simply
 * asks for the next index, and needs no new backup.
 */
export function account_seed_hex(mnemonic: string, account: number): string;
/**
 * True if `secret` is a well-formed recovery phrase (right words, right checksum).
 * Lets the UI validate what was typed before trying to open a wallet with it.
 */
export function is_valid_mnemonic(secret: string): boolean;
/**
 * Generate a new wallet as a **12-word recovery phrase** (128 bits of entropy).
 *
 * Twelve words is not a shortcut: an Orchard key lives on the Pallas curve, whose
 * ~128-bit security caps what any seed can buy. A longer phrase would be more to
 * write down for no additional strength — and a phrase people actually finish
 * writing down is the one that saves their funds.
 */
export function new_wallet_mnemonic(network: string): MnemonicWallet;
/**
 * Device half of a **non-custodial payment**. Given the wallet seed and, from the
 * server's `prepare` response, a spend's `alpha` randomizer and the payment `sighash`,
 * returns the 64-byte RedPallas spend-auth signature (hex). The seed never leaves the
 * device; the server applies this signature and broadcasts. No proving circuit.
 */
export function sign_spend_auth(seed_hex: string, alpha_hex: string, sighash_hex: string): string;
/**
 * Generate a brand-new wallet: a random 32-byte seed (browser CSPRNG) and its
 * `zkas:` address. Retries the negligibly-rare case where a random seed is
 * not a valid Orchard spending key.
 */
export function new_wallet(network: string): Wallet;
/**
 * Verify that `signature_hex` (`fvk ‖ sig`) proves control of `address` over
 * `message`. Returns `true` iff valid. The network is taken from the address
 * prefix, matching how the signature was produced.
 */
export function verify(address: string, message: string, signature_hex: string): boolean;
/**
 * The `zkas:` address of one account of a recovery phrase, without going through
 * the raw key — so a caller can preview or discover accounts cheaply.
 */
export function account_address(mnemonic: string, network: string, account: number): string;
/**
 * r" Deferred promise - an object that has `resolve()` and `reject()`
 * r" functions that can be called outside of the promise body.
 * r" WARNING: This function uses `eval` and can not be used in environments
 * r" where dynamically-created code can not be executed such as web browser
 * r" extensions.
 * r" @category General
 */
export function defer(): Promise<any>;
/**
 * Initialize Rust panic handler in browser mode.
 *
 * This will output additional debug information during a panic in the browser
 * by creating a full-screen `DIV`. This is useful on mobile devices or where
 * the user otherwise has no access to console/developer tools. Use
 * {@link presentPanicHookLogs} to activate the panic logs in the
 * browser environment.
 * @see {@link presentPanicHookLogs}
 * @category General
 */
export function initBrowserPanicHook(): void;
/**
 * Present panic logs to the user in the browser.
 *
 * This function should be called after a panic has occurred and the
 * browser-based panic hook has been activated. It will present the
 * collected panic logs in a full-screen `DIV` in the browser.
 * @see {@link initBrowserPanicHook}
 * @category General
 */
export function presentPanicHookLogs(): void;
/**
 * Initialize Rust panic handler in console mode.
 *
 * This will output additional debug information during a panic to the console.
 * This function should be called right after loading WASM libraries.
 * @category General
 */
export function initConsolePanicHook(): void;
/**
 * Configuration for the WASM32 bindings runtime interface.
 * @see {@link IWASM32BindingsConfig}
 * @category General
 */
export function initWASM32Bindings(config: IWASM32BindingsConfig): void;
/**
 * Set the logger log level using a string representation.
 * Available variants are: 'off', 'error', 'warn', 'info', 'debug', 'trace'
 * @category General
 */
export function setLogLevel(level: "off" | "error" | "warn" | "info" | "debug" | "trace"): void;
/**
 *
 *  Kaspa `Address` version (`PubKey`, `PubKey ECDSA`, `ScriptHash`)
 *
 * @category Address
 */
export enum AddressVersion {
  /**
   * PubKey addresses always have the version byte set to 0
   */
  PubKey = 0,
  /**
   * PubKey ECDSA addresses always have the version byte set to 1
   */
  PubKeyECDSA = 1,
  /**
   * ScriptHash addresses always have the version byte set to 8
   */
  ScriptHash = 8,
  /**
   * ZKas shielded (Orchard) addresses have the version byte set to 9.
   * The payload is the 43-byte raw Orchard address (diversifier ‖ pk_d). Such
   * an address is never spent through a transparent script — it is the
   * recipient of a shielded (Orchard) output — so it maps to no standard
   * script class (PLAN §2.10).
   */
  ShieldedOrchard = 9,
}

/**
 * Interface for configuring workflow-rs WASM32 bindings.
 *
 * @category General
 */
export interface IWASM32BindingsConfig {
    /**
     * This option can be used to disable the validation of class names
     * for instances of classes exported by Rust WASM32 when passing
     * these classes to WASM32 functions.
     *
     * This can be useful to programmatically disable checks when using
     * a bundler that mangles class symbol names.
     */
    validateClassNames : boolean;
}


/**
 *
 * Abortable trigger wraps an `Arc<AtomicBool>`, which can be cloned
 * to signal task terminating using an atomic bool.
 *
 * ```text
 * let abortable = Abortable::default();
 * let result = my_task(abortable).await?;
 * // ... elsewhere
 * abortable.abort();
 * ```
 *
 * @category General
 */
export class Abortable {
  free(): void;
  isAborted(): boolean;
  constructor();
  abort(): void;
  check(): void;
  reset(): void;
}
/**
 * Error emitted by [`Abortable`].
 * @category General
 */
export class Aborted {
  private constructor();
  free(): void;
}
/**
 * Kaspa [`Address`] struct that serializes to and from an address format string: `kaspa:qz0s...t8cv`.
 *
 * @category Address
 */
export class Address {
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  constructor(address: string);
  /**
   * Convert an address to a string.
   */
  toString(): string;
  static validate(address: string): boolean;
  readonly prefix: string;
  readonly payload: string;
  readonly version: string;
  set setPrefix(value: string);
}
/**
 * @category General
 */
export class Hash {
  free(): void;
  constructor(hex_str: string);
  toString(): string;
}
/**
 * A freshly generated wallet backed by a recovery phrase.
 */
export class MnemonicWallet {
  private constructor();
  free(): void;
  /**
   * The BIP-39 recovery phrase. **This is the secret** — it restores the wallet
   * anywhere, forever.
   */
  mnemonic: string;
  /**
   * The `zkas:` shielded address the phrase derives.
   */
  address: string;
}
/**
 * A message signature asserting control of an address.
 */
export class Signature {
  private constructor();
  free(): void;
  /**
   * The address the signature asserts control of.
   */
  address: string;
  /**
   * `fvk ‖ sig`, hex-encoded (96 + 64 bytes). Discloses viewing capability by
   * design — the FVK binds the signature to the address.
   */
  signature_hex: string;
}
/**
 * A freshly generated wallet: the secret seed and its public address.
 */
export class Wallet {
  private constructor();
  free(): void;
  /**
   * 32-byte spending seed, hex-encoded. **This is the secret** — whoever holds
   * it controls the funds.
   */
  seed_hex: string;
  /**
   * The `zkas:` shielded address derived from the seed.
   */
  address: string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_get_mnemonicwallet_address: (a: number) => [number, number];
  readonly __wbg_get_mnemonicwallet_mnemonic: (a: number) => [number, number];
  readonly __wbg_mnemonicwallet_free: (a: number, b: number) => void;
  readonly __wbg_set_mnemonicwallet_address: (a: number, b: number, c: number) => void;
  readonly __wbg_set_mnemonicwallet_mnemonic: (a: number, b: number, c: number) => void;
  readonly __wbg_signature_free: (a: number, b: number) => void;
  readonly __wbg_wallet_free: (a: number, b: number) => void;
  readonly account_address: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
  readonly account_seed_hex: (a: number, b: number, c: number) => [number, number, number, number];
  readonly address_from_seed: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly fvk_hex: (a: number, b: number) => [number, number, number, number];
  readonly is_valid_mnemonic: (a: number, b: number) => number;
  readonly new_wallet: (a: number, b: number) => [number, number, number];
  readonly new_wallet_mnemonic: (a: number, b: number) => [number, number, number];
  readonly sign: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly sign_spend_auth: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly verify: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly verify_and_sign_payment: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint, h: bigint, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number, number, number];
  readonly __wbg_get_signature_address: (a: number) => [number, number];
  readonly __wbg_get_signature_signature_hex: (a: number) => [number, number];
  readonly __wbg_get_wallet_address: (a: number) => [number, number];
  readonly __wbg_get_wallet_seed_hex: (a: number) => [number, number];
  readonly __wbg_set_signature_address: (a: number, b: number, c: number) => void;
  readonly __wbg_set_signature_signature_hex: (a: number, b: number, c: number) => void;
  readonly __wbg_set_wallet_address: (a: number, b: number, c: number) => void;
  readonly __wbg_set_wallet_seed_hex: (a: number, b: number, c: number) => void;
  readonly __wbg_hash_free: (a: number, b: number) => void;
  readonly hash_constructor: (a: number, b: number) => number;
  readonly hash_toString: (a: number) => [number, number];
  readonly __wbg_address_free: (a: number, b: number) => void;
  readonly address_constructor: (a: number, b: number) => number;
  readonly address_payload: (a: number) => [number, number];
  readonly address_prefix: (a: number) => [number, number];
  readonly address_set_setPrefix: (a: number, b: number, c: number) => void;
  readonly address_toString: (a: number) => [number, number];
  readonly address_validate: (a: number, b: number) => number;
  readonly address_version: (a: number) => [number, number];
  readonly defer: () => any;
  readonly initBrowserPanicHook: () => void;
  readonly initConsolePanicHook: () => void;
  readonly initWASM32Bindings: (a: any) => [number, number];
  readonly presentPanicHookLogs: () => void;
  readonly __wbg_abortable_free: (a: number, b: number) => void;
  readonly __wbg_aborted_free: (a: number, b: number) => void;
  readonly abortable_abort: (a: number) => void;
  readonly abortable_check: (a: number) => [number, number];
  readonly abortable_isAborted: (a: number) => number;
  readonly abortable_new: () => number;
  readonly abortable_reset: (a: number) => void;
  readonly setLogLevel: (a: any) => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
