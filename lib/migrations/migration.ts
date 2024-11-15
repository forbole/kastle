import v1_4_0 from "@/lib/migrations/1.4.0";

export class MigrationManager {
  private migrations: Record<string, () => Promise<void>>;

  constructor() {
    this.migrations = {
      "1.4.0": v1_4_0,
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
