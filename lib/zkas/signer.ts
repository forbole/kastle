import type { ZKasSigner, ZKasNetwork } from "./client";
import init, {
  account_seed_hex,
  address_from_seed,
  fvk_hex,
  verify_and_sign_payment,
} from "../../wasm/zkas-signer/firecash_signer.js";

let ready: Promise<void> | undefined;
const PINNED_WASM_SHA256 =
  "ea0ec55a2cef0bb7f3cd6ce80b0e5c218693e0e97be49c80a73587b1eefcd409";

export function initZKasSigner(bytesOrUrl: Uint8Array | string): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const bytes =
        typeof bytesOrUrl === "string"
          ? await fetchSignerBytes(bytesOrUrl)
          : bytesOrUrl;
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", copy.buffer),
      );
      const hash = Array.from(digest, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== PINNED_WASM_SHA256) {
        throw new Error("ZKas signer binary does not match the pinned version");
      }
      await init({ module_or_path: copy });
    })()
      .then(() => undefined)
      .catch((error: unknown) => {
        ready = undefined;
        throw error;
      });
  }
  return ready;
}

async function fetchSignerBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("Unable to load the ZKas signer");
  return new Uint8Array(await response.arrayBuffer());
}

export async function deriveZKasAccount(
  mnemonic: string,
  accountIndex: number,
  network: ZKasNetwork,
): Promise<{ address: string; token: string; signer: ZKasSigner }> {
  if (!ready) throw new Error("ZKas signer is not initialized");
  await ready;
  if (
    !Number.isSafeInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex >= 0x80000000
  ) {
    throw new Error("Invalid ZKas account index");
  }
  const seedHex = account_seed_hex(mnemonic, accountIndex);
  return deriveZKasAccountFromSeed(seedHex, network);
}

export async function deriveZKasAccountFromSeed(
  seedHex: string,
  network: ZKasNetwork,
): Promise<{ address: string; token: string; signer: ZKasSigner }> {
  if (!ready) throw new Error("ZKas signer is not initialized");
  await ready;
  if (!/^[0-9a-f]{64}$/.test(seedHex))
    throw new Error("Invalid ZKas spending seed");
  const address = address_from_seed(seedHex, network);
  const token = await deriveWalletToken(seedHex, network);
  const signer: ZKasSigner = {
    address: () => address,
    fullViewingKeyHex: async () => fvk_hex(seedHex),
    verifyAndSign: async (input) => {
      if (input.network !== network) {
        throw new Error("ZKas signing network changed");
      }
      try {
        const signatures = verify_and_sign_payment(
          seedHex,
          network,
          input.recipient,
          input.amountSompi,
          input.maxFeeSompi,
          input.bundleHex,
          JSON.stringify(input.disclosure),
          JSON.stringify(input.spendAuth),
        );
        return JSON.parse(signatures);
      } catch {
        throw new Error("ZKas signer rejected the prepared payment");
      }
    },
  };
  return { address, token, signer };
}

async function deriveWalletToken(
  seedHex: string,
  network: ZKasNetwork,
): Promise<string> {
  const bytes = Uint8Array.from(seedHex.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = new TextEncoder().encode(
    `kastle:zkas:wallet-token:v1:${network}`,
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  return Array.from(mac.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
