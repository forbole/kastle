import type { Meta, StoryObj } from "@storybook/react";
import QuoteSummary from "./QuoteSummary";

const meta: Meta<typeof QuoteSummary> = {
  title: "Popup/Kasseal/Components/QuoteSummary",
  component: QuoteSummary,
  decorators: [
    (Story) => (
      <div className="w-[343px] bg-icy-blue-950 p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof QuoteSummary>;

export const Buy: Story = {
  args: {
    side: "buy",
    boundKind: "max-paid",
    pay: "100 KAS",
    receive: "1,000,000 SEAL",
    bound: "101 KAS",
    fee: "1 KAS",
    networkFee: "0.0002 KAS",
    slippage: "1%",
  },
};
export const PoolBuy: Story = {
  args: {
    side: "buy",
    boundKind: "min-received",
    pay: "100 KAS",
    receive: "1,000,000 SEAL",
    bound: "990,000 SEAL",
    fee: "1 KAS",
    slippage: "1%",
  },
};
export const Sell: Story = {
  args: {
    side: "sell",
    boundKind: "min-received",
    pay: "1,000,000 SEAL",
    receive: "98 KAS",
    bound: "97.02 KAS",
    fee: "1 KAS",
    slippage: "1%",
  },
};
