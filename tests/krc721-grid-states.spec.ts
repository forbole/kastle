import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The NFT tab renders the real NftList / KRC721 screen here (built by
// tests/krc721-grid/vite.config.mjs with its context hooks stubbed) and the
// indexer + Pinata routed to fixtures. Every branch below was a rendering
// defect in the audit: a failed card left a hole, a failed fetch and an empty
// wallet both painted a blank panel, a listed NFT got a live Transfer button.

const BURI = "ipfs://bafyTest";
const GW = "https://gateway.pinata.cloud/ipfs/bafyTest";
const OWNER = "kaspa:owner";
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    tick: "KSPR",
    buri: BURI,
    tokenId: String(i + 1),
    status: { state: "unlisted" },
  }));

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-krc721-grid-${process.pid}`);
  await build({
    configFile: path.resolve("tests/krc721-grid/vite.config.mjs"),
    build: { outDir },
  });
  server = http.createServer((req, res) => {
    const p = path.join(outDir, (req.url ?? "/").split("?")[0]);
    const file =
      existsSync(p) && !p.endsWith("/") ? p : path.join(outDir, "index.html");
    res.writeHead(200, {
      "content-type":
        { ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] ??
        "text/html",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

type Fixture = {
  pages?: ReturnType<typeof rows>[];
  indexerStatus?: number;
  // Holds every indexer response, so the first intersection lands mid-load.
  indexerDelayMs?: number;
  metaStatus?: number;
  tokenState?: string;
  tokenStatus?: number;
  tokenOwner?: string;
};

async function open(page: Page, query: string, fx: Fixture = {}) {
  const {
    pages = [rows(3)],
    indexerStatus = 200,
    indexerDelayMs = 0,
    metaStatus = 200,
    tokenState = "unlisted",
    tokenStatus = 200,
    tokenOwner = OWNER,
  } = fx;
  const reqs: string[] = [];
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route(/krc721-indexer\.kaspa\.com/, async (route) => {
    if (indexerDelayMs) await new Promise((r) => setTimeout(r, indexerDelayMs));
    const url = route.request().url();
    reqs.push(url);
    const addr = url.match(/\/address\/[^?]+(?:\?offset=(\d+))?$/);
    if (addr) {
      if (indexerStatus !== 200)
        return route.fulfill({ status: indexerStatus, body: "{}" });
      const i = addr[1] ? Number(addr[1]) : 0;
      return route.fulfill(
        json({
          message: "success",
          result: pages[i] ?? [],
          next: pages[i + 1] ? String(i + 1) : undefined,
        }),
      );
    }
    const token = url.match(/nfts\/(\w+)\/(\d+)$/);
    if (token) {
      if (tokenStatus !== 200)
        return route.fulfill({ status: tokenStatus, body: "{}" });
      return route.fulfill(
        json({
          message: "success",
          result: {
            tick: token[1],
            tokenId: token[2],
            owner: tokenOwner,
            status: { state: tokenState },
          },
        }),
      );
    }
    return route.fulfill(
      json({ message: "success", result: { tick: "KSPR", buri: BURI } }),
    );
  });
  await page.route(/gateway\.pinata\.cloud/, (route) => {
    const url = route.request().url();
    reqs.push(url);
    if (url.endsWith(".png"))
      return route.fulfill({ status: 200, contentType: "image/png", body: "" });
    if (metaStatus !== 200)
      return route.fulfill({ status: metaStatus, body: "" });
    // KSPR layout: only `{id}.json` exists.
    if (!url.endsWith(".json")) return route.fulfill({ status: 404, body: "" });
    const id = url.match(/bafyTest\/(\d+)/)?.[1];
    return route.fulfill(
      json({
        name: `KSPR #${id}`,
        image: `${BURI}/${id}.png`,
        description: `desc ${id}`,
        attributes: [],
      }),
    );
  });
  await page.goto(`${base}/?${query}`);
  return reqs;
}

const labels = (page: Page) =>
  page.locator("#popup .grid > div > div:last-child").allInnerTexts();

test("KSPR renders: cards from the row, one layout probe per page", async ({
  page,
}) => {
  const reqs = await open(page, "route=/grid", { pages: [rows(6)] });
  await expect(page.locator("img[alt='KSPR #6']")).toHaveAttribute(
    "src",
    `${GW}/6.png`,
  );
  expect(await labels(page)).toEqual(rows(6).map((r) => `KSPR #${r.tokenId}`));
  const bare = reqs.filter((u) => /bafyTest\/\d+$/.test(u));
  expect(bare).toEqual([`${GW}/1`]);
  expect(reqs.filter((u) => u.endsWith(".json"))).toHaveLength(6);
});

test("metadata failure keeps the card and never retries as .json", async ({
  page,
}) => {
  const reqs = await open(page, "route=/grid", { metaStatus: 500 });
  await expect(page.locator("#popup .grid > div")).toHaveCount(3);
  await expect(page.locator("img[alt='Placeholder']")).toHaveCount(3);
  await page.waitForTimeout(300);
  expect(reqs.filter((u) => u.includes("pinata"))).toEqual([
    `${GW}/1`,
    `${GW}/2`,
    `${GW}/3`,
  ]);
});

test("indexer failure shows the error, Retry recovers", async ({ page }) => {
  await open(page, "route=/grid", { indexerStatus: 500 });
  await expect(page.getByText("Couldn’t load your NFTs")).toBeVisible();
  await expect(page.getByText("No NFTs found")).toHaveCount(0);
  await page.unroute(/krc721-indexer\.kaspa\.com/);
  await page.route(/krc721-indexer\.kaspa\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "success", result: rows(2) }),
    }),
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("#popup .grid > div")).toHaveCount(2);
  await expect(page.getByText("Couldn’t load your NFTs")).toHaveCount(0);
});

test("empty wallet says so, and is not the error message", async ({ page }) => {
  await open(page, "route=/grid", { pages: [[]] });
  await expect(page.getByText("No NFTs found")).toBeVisible();
  await expect(page.getByText("Couldn’t load your NFTs")).toHaveCount(0);
});

test("ERC-721 pages follow the KRC-721 pages (Do-not-break)", async ({
  page,
}) => {
  const erc = [
    {
      chainId: "0x28c58",
      chainIndex: 0,
      items: [
        {
          id: "7",
          token: { address_hash: "0xa" },
          metadata: { name: "L2 Cat" },
        },
      ],
    },
    {
      chainId: "0x11bd9",
      chainIndex: 1,
      items: [
        {
          id: "8",
          token: { address_hash: "0xb" },
          metadata: { name: "Igra Dog" },
        },
      ],
    },
  ];
  await open(
    page,
    `route=/grid&erc721=${encodeURIComponent(JSON.stringify(erc))}`,
    {
      pages: [
        rows(3),
        rows(3).map((r) => ({ ...r, tokenId: String(+r.tokenId + 3) })),
      ],
    },
  );
  // No CSS in this build, so the scroll sentinel is always in view and the
  // pager walks every page by itself.
  await expect(page.getByText("Igra Dog")).toBeVisible();
  expect(await labels(page)).toEqual([
    ...[1, 2, 3, 4, 5, 6].map((i) => `KSPR #${i}`),
    "L2 Cat",
    "Igra Dog",
  ]);
});

// QA wallet shape: no KRC-721, nothing on Kasplex, kastlewallet.igra on the
// INS V2 registry. Igra is chainIndex 1, so it lands on erc721Data[1].
const igraPage = (items: unknown[]) => [
  { chainId: "0x3173b", chainIndex: 0, items: [] },
  { chainId: "0x97b1", chainIndex: 1, items },
];
const insName = (id: string, registry: string, name: string) => ({
  id,
  token: { address_hash: registry },
  metadata: { name },
});

test("INS names stay out of the NFT tab, which then says it is empty", async ({
  page,
}) => {
  const erc = igraPage([
    insName(
      "294",
      "0x7E7018959bf44045F01D176D8db1594894CBf4E9",
      "kastlewallet.igra",
    ),
    insName("5", "0x42c2f5aa0c4aacfd07e5fbe65b898212c1c2879c", "old.igra"),
  ]);
  await open(
    page,
    `route=/grid&erc721=${encodeURIComponent(JSON.stringify(erc))}`,
    { pages: [[]] },
  );
  await expect(page.getByText("No NFTs found")).toBeVisible();
  await expect(page.locator("#popup .grid > div")).toHaveCount(0);
  await expect(page.getByText("kastlewallet.igra")).toHaveCount(0);
});

test("the empty message never renders above an L2 card", async ({ page }) => {
  const erc = igraPage([
    insName(
      "294",
      "0x7E7018959bf44045F01D176D8db1594894CBf4E9",
      "kastlewallet.igra",
    ),
    insName("8", "0xb", "Igra Dog"),
  ]);
  await open(
    page,
    `route=/grid&erc721=${encodeURIComponent(JSON.stringify(erc))}`,
    { pages: [[]] },
  );
  await expect(page.getByText("Igra Dog")).toBeVisible();
  expect(await labels(page)).toEqual(["Igra Dog"]);
  await expect(page.getByText("No NFTs found")).toHaveCount(0);
});

// The stall behind the QA screenshot: the sentinel is on screen from the first
// paint, its first intersection lands while KRC-721 is still loading and is
// dropped, and a grid too short to scroll never produces another one.
test("L2 pages load without a scroll when KRC-721 was slow", async ({
  page,
}) => {
  const erc = igraPage([insName("8", "0xb", "Igra Dog")]);
  await open(
    page,
    `route=/grid&erc721=${encodeURIComponent(JSON.stringify(erc))}`,
    { pages: [[]], indexerDelayMs: 500 },
  );
  await expect(page.getByText("Igra Dog")).toBeVisible();
  await expect(page.getByText("Scroll to load more...")).toHaveCount(0);
});

test("testnet-10 uses the dev indexer host", async ({ page }) => {
  const reqs = await open(page, "route=/grid&network=testnet-10", {
    pages: [rows(1)],
  });
  await expect(page.locator("#popup .grid > div")).toHaveCount(1);
  expect(reqs[0]).toMatch(
    /^https:\/\/dev-krc721-indexer\.kaspa\.com\/api\/v1\/krc721\/testnet-10\/address\//,
  );
});

test.describe("detail screen Transfer gate", () => {
  const transfer = (page: Page) =>
    page.getByRole("button", { name: /Transfer/ });

  for (const [label, fx, message] of [
    ["listed", { tokenState: "listed" }, /listed on a marketplace/],
    [
      "token fetch failed",
      { tokenStatus: 500 },
      /Couldn’t confirm this NFT is unlisted/,
    ],
    [
      "not the owner",
      { tokenOwner: "kaspa:other" },
      /isn’t owned by this account/,
    ],
  ] as const) {
    test(`${label} → disabled with a reason`, async ({ page }) => {
      await open(page, "route=/krc721/KSPR/1", fx);
      await expect(transfer(page)).toBeDisabled();
      await expect(transfer(page)).toHaveAttribute(
        "data-tooltip-content",
        message,
      );
    });
  }

  test("unlisted and owned → enabled", async ({ page }) => {
    await open(page, "route=/krc721/KSPR/1");
    await expect(transfer(page)).toBeEnabled();
  });

  test("metadata failure shows a message, not a skeleton", async ({ page }) => {
    await open(page, "route=/krc721/KSPR/1", { metaStatus: 500 });
    await expect(
      page.getByText("Couldn’t load this NFT’s metadata"),
    ).toBeVisible();
    await expect(page.locator(".animate-pulse")).toHaveCount(0);
  });
});
