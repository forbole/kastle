export default async function handler() {
  const settings = await storage.getItem<{ networkId: string }>(
    "local:settings",
  );
  if (settings?.networkId === "testnet-11") {
    await storage.setItem<{ networkId: string }>("local:settings", {
      ...settings,
      networkId: "testnet-10",
    });
  }
}
