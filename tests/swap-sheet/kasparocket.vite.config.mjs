// The real Swap screen with KaspaRocket chosen: the copy-logs harness's
// build, its stubs swapped for ./kasparocket-stubs.tsx (which re-exports
// them), and KaspaRocket's client and listing stubbed. No request leaves.
import path from "node:path";
import base from "../swap-bridge-copy-logs/vite.config.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const mine = path.join(here, "kasparocket-stubs.tsx");
const theirs = path.join(repo, "tests/swap-bridge-copy-logs/stubs.tsx");
const swapped = [
  theirs,
  path.join(repo, "hooks/swap/kasparocketListing.ts"),
  path.join(repo, "lib/kasparocket/client.ts"),
];

export default {
  ...base,
  plugins: [
    {
      name: "kasparocket-render-stubs",
      enforce: "pre",
      async resolveId(id, importer) {
        if (importer === mine || id.startsWith("\0")) return null;
        const r = await this.resolve(id, importer, { skipSelf: true });
        return r && swapped.includes(r.id) ? mine : null;
      },
    },
    ...base.plugins,
  ],
};
