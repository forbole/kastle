import { Buffer } from "buffer";

const ALLOWED_KEYS = ["wallets"] as const;

type AllowedKey = (typeof ALLOWED_KEYS)[number];

// Types
interface EncryptedData {
  iv: string;
  data: string;
}

// Crypto configuration
const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const VERIFICATION_KEY = "verification";
export const KEYRING_CHANGE_TIME = "KEYRING_CHANGE_TIME";
const VERIFICATION_VALUE = "keyring-verification-value";

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

    const salt = this.generateSalt();
    await storage.setItem(
      `local:${this.namespace}:salt`,
      Buffer.from(salt).toString("base64"),
    );

    const key = await this.deriveKey(password, salt);
    await this.storeVerificationValue(key);

    this.masterKey = key;
    await this.updateWalletChangeTime();
  }

  async unlock(password: string): Promise<boolean> {
    const saltBase64 = await storage.getItem<string>(
      `local:${this.namespace}:salt`,
    );
    if (!saltBase64) {
      throw new Error("Keyring is not initialized");
    }

    const salt = Buffer.from(saltBase64, "base64");
    const key = await this.deriveKey(password, salt);

    const isValid = await this.verifyKey(key);
    if (!isValid) {
      this.masterKey = null;
      return false;
    }

    this.masterKey = key;
    await this.updateWalletChangeTime();
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
    const saltBase64 = await storage.getItem<string>(
      `local:${this.namespace}:salt`,
    );
    if (!saltBase64) {
      throw new Error("Keyring is not initialized");
    }

    const salt = Buffer.from(saltBase64, "base64");
    const key = await this.deriveKey(currentPassword, salt);

    return await this.verifyKey(key);
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const saltBase64 = await storage.getItem<string>(
      `local:${this.namespace}:salt`,
    );
    if (!saltBase64) {
      throw new Error("Keyring is not initialized");
    }

    const oldSalt = Buffer.from(saltBase64, "base64");
    const oldKey = await this.deriveKey(currentPassword, oldSalt);

    // Verify the old password
    const isValid = await this.verifyKey(oldKey);
    if (!isValid) {
      return false;
    }

    // Generate new salt and key
    const newSalt = this.generateSalt();
    const newKey = await this.deriveKey(newPassword, newSalt);

    // Get all current data
    const keys = this.listKeys();
    const dataToMigrate = await Promise.all(
      keys.map(async (key) => {
        const data = await this.getValue(key);
        return data ? { key, value: data } : null;
      }),
    );

    // Store new salt
    await storage.setItem(
      `local:${this.namespace}:salt`,
      Buffer.from(newSalt).toString("base64"),
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

    return true;
  }

  async clear(): Promise<void> {
    const keys = this.listKeys();
    await Promise.all([
      ...keys.map((key) => this.removeValue(key)),
      storage.removeItem(`local:${this.namespace}:salt`),
      storage.removeItem(`local:${this.namespace}:${VERIFICATION_KEY}`),
    ]);

    this.masterKey = null;
    await this.updateWalletChangeTime();
  }

  private generateIV(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(12));
  }

  private generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
  }

  private async deriveKey(
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
        iterations: 100000,
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
