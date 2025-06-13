import { Buffer } from "buffer";
import { argon2id } from "hash-wasm";

const ALLOWED_KEYS = ["wallets"] as const;

type AllowedKey = (typeof ALLOWED_KEYS)[number];

// Types
interface EncryptedData {
  iv: string;
  data: string;
}

interface KeyDerivationInfo {
  method: "pbkdf2" | "argon2id";
  salt: string;
}

// Crypto configuration
const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const VERIFICATION_KEY = "verification";
export const KEYRING_CHANGE_TIME = "KEYRING_CHANGE_TIME";
const VERIFICATION_VALUE = "keyring-verification-value";

// PBKDF2 configuration
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_LENGTH = 16;

// Argon2id configuration
const ARGON2ID_MEMORY_COST = 64 * 1024; // 64 MiB in KB
const ARGON2ID_TIME_COST = 3;
const ARGON2ID_OUTPUT_LENGTH = 32; // bytes
const ARGON2ID_SALT_LENGTH = 32; // bytes

export class Keyring {
  private masterKey: CryptoKey | null = null;
  private namespace: string;

  constructor(namespace: string = "keyring") {
    this.namespace = namespace;
  }

  updateWalletChangeTime() {
    return storage.setItem(`local:${KEYRING_CHANGE_TIME}`, Date.now());
  }

  async isInitialized(): Promise<boolean> {
    const verification = await storage.getItem<EncryptedData>(
      `local:${this.namespace}:${VERIFICATION_KEY}`,
    );
    return verification !== null;
  }

  isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  async initialize(password: string): Promise<void> {
    if (await this.isInitialized()) {
      throw new Error("Keyring is already initialized");
    }

    // Use Argon2id for new users
    const method = "argon2id";
    const salt = this.generateSalt(method);

    // Store key derivation info
    const keyDerivationInfo: KeyDerivationInfo = {
      method,
      salt: Buffer.from(salt).toString("base64"),
    };

    await storage.setItem(
      `local:${this.namespace}:keyDerivationInfo`,
      keyDerivationInfo,
    );

    const key = await this.deriveKey(password, salt, method);
    await this.storeVerificationValue(key);

    this.masterKey = key;
    await this.updateWalletChangeTime();
  }

  async unlock(password: string): Promise<boolean> {
    // Try to get key derivation info first (for new users)
    const keyDerivationInfo = await storage.getItem<KeyDerivationInfo>(
      `local:${this.namespace}:keyDerivationInfo`,
    );

    let method: "pbkdf2" | "argon2id";
    let salt: Uint8Array;

    if (keyDerivationInfo) {
      // New user with Argon2id
      method = keyDerivationInfo.method;
      salt = Buffer.from(keyDerivationInfo.salt, "base64");
    } else {
      // Legacy user with PBKDF2
      const saltBase64 = await storage.getItem<string>(
        `local:${this.namespace}:salt`,
      );
      if (!saltBase64) {
        throw new Error("Keyring is not initialized");
      }

      method = "pbkdf2";
      salt = Buffer.from(saltBase64, "base64");
    }

    const key = await this.deriveKey(password, salt, method);

    const isValid = await this.verifyKey(key);
    if (!isValid) {
      this.masterKey = null;
      return false;
    }

    this.masterKey = key;
    await this.updateWalletChangeTime();

    // If using legacy PBKDF2, migrate to Argon2id
    if (method === "pbkdf2") {
      await this.migrateToArgon2id(password);
    }

    return true;
  }

  async lock(): Promise<void> {
    this.masterKey = null;
    await this.updateWalletChangeTime();
  }

  async setValue<T>(key: AllowedKey, value: T): Promise<void> {
    if (!this.masterKey) {
      throw new Error("Keyring is locked");
    }

    const iv = this.generateIV();
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(value));

    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      this.masterKey,
      data,
    );

    const encryptedData: EncryptedData = {
      iv: Buffer.from(iv).toString("base64"),
      data: Buffer.from(encrypted).toString("base64"),
    };

    await storage.setItem(`local:${this.namespace}:${key}`, encryptedData);
  }

  async getValue<T>(key: AllowedKey): Promise<T | null> {
    if (!this.masterKey) {
      throw new Error("Keyring is locked");
    }

    const encryptedData = await storage.getItem<EncryptedData>(
      `local:${this.namespace}:${key}`,
    );
    if (!encryptedData) {
      return null;
    }

    const iv = Buffer.from(encryptedData.iv, "base64");
    const data = Buffer.from(encryptedData.data, "base64");

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      this.masterKey,
      data,
    );

    const decoder = new TextDecoder();
    const decodedData = decoder.decode(decrypted);
    return JSON.parse(decodedData);
  }

  async removeValue(key: string): Promise<void> {
    if (key === VERIFICATION_KEY) {
      throw new Error("Reserved key name");
    }
    await storage.removeItem(`local:${this.namespace}:${key}`);
  }

  listKeys() {
    return ALLOWED_KEYS;
  }

  async checkPassword(currentPassword: string) {
    // Try to get key derivation info first (for new users)
    const keyDerivationInfo = await storage.getItem<KeyDerivationInfo>(
      `local:${this.namespace}:keyDerivationInfo`,
    );

    let method: "pbkdf2" | "argon2id";
    let salt: Uint8Array;

    if (keyDerivationInfo) {
      // New user with Argon2id
      method = keyDerivationInfo.method;
      salt = Buffer.from(keyDerivationInfo.salt, "base64");
    } else {
      // Legacy user with PBKDF2
      const saltBase64 = await storage.getItem<string>(
        `local:${this.namespace}:salt`,
      );
      if (!saltBase64) {
        throw new Error("Keyring is not initialized");
      }

      method = "pbkdf2";
      salt = Buffer.from(saltBase64, "base64");
    }

    const key = await this.deriveKey(currentPassword, salt, method);
    return await this.verifyKey(key);
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    // Try to get key derivation info first (for new users)
    const keyDerivationInfo = await storage.getItem<KeyDerivationInfo>(
      `local:${this.namespace}:keyDerivationInfo`,
    );

    let method: "pbkdf2" | "argon2id";
    let oldSalt: Uint8Array;

    if (keyDerivationInfo) {
      // New user with Argon2id
      method = keyDerivationInfo.method;
      oldSalt = Buffer.from(keyDerivationInfo.salt, "base64");
    } else {
      // Legacy user with PBKDF2
      const saltBase64 = await storage.getItem<string>(
        `local:${this.namespace}:salt`,
      );
      if (!saltBase64) {
        throw new Error("Keyring is not initialized");
      }

      method = "pbkdf2";
      oldSalt = Buffer.from(saltBase64, "base64");
    }

    const oldKey = await this.deriveKey(currentPassword, oldSalt, method);

    // Verify the old password
    const isValid = await this.verifyKey(oldKey);
    if (!isValid) {
      return false;
    }

    // Generate new salt and key with Argon2id
    const newMethod = "argon2id";
    const newSalt = this.generateSalt(newMethod);
    const newKey = await this.deriveKey(newPassword, newSalt, newMethod);

    // Get all current data
    const keys = this.listKeys();
    const dataToMigrate = await Promise.all(
      keys.map(async (key) => {
        const data = await this.getValue(key);
        return data ? { key, value: data } : null;
      }),
    );

    // Store new key derivation info
    const newKeyDerivationInfo: KeyDerivationInfo = {
      method: newMethod,
      salt: Buffer.from(newSalt).toString("base64"),
    };

    await storage.setItem(
      `local:${this.namespace}:keyDerivationInfo`,
      newKeyDerivationInfo,
    );

    // Update master key and re-encrypt all data
    this.masterKey = newKey;
    await this.updateWalletChangeTime();
    await Promise.all(
      dataToMigrate.map(async (item) => {
        if (!item) return;
        await this.setValue(item.key, item.value);
      }),
    );

    // Update verification value
    await this.storeVerificationValue(newKey);

    // Remove old salt if it exists (for legacy users)
    if (method === "pbkdf2") {
      await storage.removeItem(`local:${this.namespace}:salt`);
    }

    return true;
  }

  async clear(): Promise<void> {
    const keys = this.listKeys();
    await Promise.all([
      ...keys.map((key) => this.removeValue(key)),
      storage.removeItem(`local:${this.namespace}:salt`),
      storage.removeItem(`local:${this.namespace}:keyDerivationInfo`),
      storage.removeItem(`local:${this.namespace}:${VERIFICATION_KEY}`),
    ]);

    this.masterKey = null;
    await this.updateWalletChangeTime();
  }

  private async migrateToArgon2id(password: string): Promise<void> {
    // Get all current data
    const keys = this.listKeys();
    const dataToMigrate = await Promise.all(
      keys.map(async (key) => {
        const data = await this.getValue(key);
        return data ? { key, value: data } : null;
      }),
    );

    // Generate new salt and key with Argon2id
    const newMethod = "argon2id";
    const newSalt = this.generateSalt(newMethod);
    const newKey = await this.deriveKey(password, newSalt, newMethod);

    // Store new key derivation info
    const keyDerivationInfo: KeyDerivationInfo = {
      method: newMethod,
      salt: Buffer.from(newSalt).toString("base64"),
    };

    await storage.setItem(
      `local:${this.namespace}:keyDerivationInfo`,
      keyDerivationInfo,
    );

    // Update master key
    this.masterKey = newKey;

    // Re-encrypt all data with the new key
    await Promise.all(
      dataToMigrate.map(async (item) => {
        if (!item) return;
        await this.setValue(item.key, item.value);
      }),
    );

    // Update verification value
    await this.storeVerificationValue(newKey);

    // Remove old salt
    await storage.removeItem(`local:${this.namespace}:salt`);
  }

  private generateIV(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(12));
  }

  private generateSalt(method: "pbkdf2" | "argon2id" = "argon2id"): Uint8Array {
    const length =
      method === "pbkdf2" ? PBKDF2_SALT_LENGTH : ARGON2ID_SALT_LENGTH;
    return crypto.getRandomValues(new Uint8Array(length));
  }

  private async deriveKeyPBKDF2(
    password: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordData,
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"],
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      {
        name: ALGORITHM,
        length: KEY_LENGTH,
      },
      false,
      ["encrypt", "decrypt"],
    );
  }

  private async deriveKeyArgon2id(
    password: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
    // Use argon2id to derive a key
    const keyBytes = await argon2id({
      password,
      salt: Buffer.from(salt).toString("hex"),
      parallelism: 1,
      iterations: ARGON2ID_TIME_COST,
      memorySize: ARGON2ID_MEMORY_COST,
      hashLength: ARGON2ID_OUTPUT_LENGTH,
      outputType: "binary",
    });

    // Import the derived key for use with AES-GCM
    return crypto.subtle.importKey(
      "raw",
      keyBytes,
      {
        name: ALGORITHM,
        length: KEY_LENGTH,
      },
      false,
      ["encrypt", "decrypt"],
    );
  }

  private async deriveKey(
    password: string,
    salt: Uint8Array,
    method: "pbkdf2" | "argon2id" = "pbkdf2",
  ): Promise<CryptoKey> {
    if (method === "argon2id") {
      return this.deriveKeyArgon2id(password, salt);
    } else {
      return this.deriveKeyPBKDF2(password, salt);
    }
  }

  private async storeVerificationValue(key: CryptoKey): Promise<void> {
    const iv = this.generateIV();
    const encoder = new TextEncoder();
    const data = encoder.encode(VERIFICATION_VALUE);

    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      data,
    );

    const encryptedData: EncryptedData = {
      iv: Buffer.from(iv).toString("base64"),
      data: Buffer.from(encrypted).toString("base64"),
    };

    await storage.setItem(
      `local:${this.namespace}:${VERIFICATION_KEY}`,
      encryptedData,
    );
  }

  private async verifyKey(key: CryptoKey): Promise<boolean> {
    try {
      const encryptedData = await storage.getItem<EncryptedData>(
        `local:${this.namespace}:${VERIFICATION_KEY}`,
      );
      if (!encryptedData) return false;

      const iv = Buffer.from(encryptedData.iv, "base64");
      const data = Buffer.from(encryptedData.data, "base64");

      const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        data,
      );

      const decoder = new TextDecoder();
      const value = decoder.decode(decrypted);
      return value === VERIFICATION_VALUE;
    } catch {
      return false;
    }
  }
}
