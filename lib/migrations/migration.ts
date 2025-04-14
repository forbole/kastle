import v2_10_1 from "@/lib/migrations/v2.10.1.ts";

export class MigrationManager {
  private migrations: Record<string, () => Promise<void>>;

  constructor() {
    this.migrations = {
      "2.10.1": v2_10_1,
    };
  }

  async run(previous: string): Promise<void> {
    for (const version in this.migrations) {
      if (this.isVersionLessThan(previous, version)) {
        await this.migrations[version]();
      }
    }
  }

  private isVersionLessThan(previous: string, target: string): boolean {
    const normalize = (v: string) => {
      const cleanVersion = v.split("-")[0];
      return cleanVersion.split(".").map((x) => parseInt(x, 10));
    };
    const previousParts = normalize(previous);
    const targetParts = normalize(target);

    if (previousParts.length !== 3 || targetParts.length !== 3) {
      throw new Error("Invalid version format");
    }

    for (let i = 0; i < 3; i++) {
      const prev = previousParts[i];
      const curr = targetParts[i];
      if (prev < curr) return true; // previous version is less than new version
      if (prev > curr) return false; // previous version is greater than new version
    }

    return false;
  }
}
