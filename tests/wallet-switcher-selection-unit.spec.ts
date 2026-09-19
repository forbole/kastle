import { expect, test } from "@playwright/test";
import { runExclusiveWalletSelection } from "@/lib/wallet-switcher-selection";

test("overlapping Kaspa and ZKas choices cannot replace an in-flight wallet selection", async () => {
  let finishSave!: () => void;
  const savePending = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const lock = { busy: false };
  let selected = "Kaspa old";
  let network = "kaspa";
  const busyStates: boolean[] = [];

  const zkasChoice = runExclusiveWalletSelection(
    lock,
    async () => {
      await savePending;
      selected = "ZKas A";
      network = "zkas";
    },
    (busy) => busyStates.push(busy),
  );
  const kaspaChoice = runExclusiveWalletSelection(
    lock,
    async () => {
      selected = "Kaspa B";
      network = "kaspa";
    },
    (busy) => busyStates.push(busy),
  );

  finishSave();
  expect(await Promise.all([zkasChoice, kaspaChoice])).toEqual([true, false]);
  expect({ selected, network, busyStates }).toEqual({
    selected: "ZKas A",
    network: "zkas",
    busyStates: [true, false],
  });
});
