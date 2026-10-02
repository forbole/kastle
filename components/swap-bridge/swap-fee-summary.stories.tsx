import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import {
  SwapFeeFootnote,
  SwapFeeSummary,
} from "@/components/swap-bridge/swap-fee-summary";

const meta: Meta<typeof SwapFeeSummary> = {
  title: "Swap/FeeSummary",
  component: SwapFeeSummary,
  decorators: [
    (Story) => (
      <div className="w-[360px] bg-daintree-800 p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SwapFeeSummary>;

export const InputTokenFee: Story = {
  args: { kastleFee: 0.75, kastleFeeSymbol: "KAS", kastleFeeBps: 75 },
  render: (args) => (
    <>
      <SwapFeeSummary {...args} />
      <SwapFeeFootnote {...args} />
    </>
  ),
};

export const OutputTokenFee: Story = {
  args: { kastleFee: 1, kastleFeeSymbol: "USDT", kastleFeeBps: 50 },
  render: InputTokenFee.render,
};

export const NoFee: Story = {
  args: { kastleFee: 0, kastleFeeSymbol: "KAS", kastleFeeBps: 0 },
  render: InputTokenFee.render,
};
