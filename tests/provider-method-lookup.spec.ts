import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Drives the real built provider (npm run build first).
const INJECTED = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.output/chrome-mv3/injected.js",
);

test("window.kastle does not resolve inherited properties as methods", async ({
  page,
}) => {
  test.skip(!fs.existsSync(INJECTED), "run `npm run build` first");

  await page.route("https://dapp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://dapp.test/");
  await page.addScriptTag({ content: fs.readFileSync(INJECTED, "utf8") });

  const result = await page.evaluate(async () => {
    const provider = (window as any).kastle;
    const posted: unknown[] = [];
    window.addEventListener("message", (e) => {
      if (e.data?.target === "background") posted.push(e.data);
    });
    const results: unknown[] = [];
    for (const method of ["__proto__", "constructor", "toString"]) {
      results.push(await provider.request(method));
    }
    await new Promise((r) => setTimeout(r, 0));
    return { results, posted };
  });
  expect(result).toEqual({
    results: [undefined, undefined, undefined],
    posted: [],
  });
});
