import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import TradePanel from "./TradePanel";

const meta: Meta<typeof TradePanel> = {
  title: "Popup/Kasseal/Components/TradePanel",
  component: TradePanel,
  decorators: [
    (Story) => (
      <div className="w-[375px] bg-icy-blue-950 p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TradePanel>;

function Interactive({ error }: { error?: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  return (
    <TradePanel
      side={side}
      onSideChange={setSide}
      amount={amount}
      onAmountChange={setAmount}
      unit={side === "buy" ? "KAS" : "SEAL"}
      estimate={amount ? "1,000 SEAL" : undefined}
      slippageBps={slippageBps}
      onSlippageChange={setSlippageBps}
      error={error}
      canReview={!!amount}
      onReview={() => {}}
    />
  );
}

export const Default: Story = { render: () => <Interactive /> };
export const WithError: Story = {
  render: () => <Interactive error="Enter a larger amount." />,
};
