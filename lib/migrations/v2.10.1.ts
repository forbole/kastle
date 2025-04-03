export default async function handler() {
  const settings = await storage.getItem<{ networkId: string }>(
    "local:settings",
  );
  if (settings?.networkId === "testnet-t11") {
    await storage.setItem<{ networkId: string }>("local:settings", {
      ...settings,
      networkId: "testnet-t10",
    });
  }
}
