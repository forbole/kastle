import type { Meta, StoryObj } from "@storybook/react";
import TokenItem from "./TokenItem";

const meta: Meta<typeof TokenItem> = {
  title: "Popup/Kcc20/Components/TokenItem",
  component: TokenItem,
  decorators: [
    (Story) => (
      <div className="w-[375px] bg-icy-blue-950 p-4 font-sans">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onClick: { action: "click" },
  },
};

export default meta;
type Story = StoryObj<typeof TokenItem>;

export const CardKcc20: Story = {
  args: {
    variant: "card",
    name: "NACHO",
    subtitle: "$0.230",
    amount: "1,000,000",
    amountFiat: "≈ $3,466 USD",
    network: "kcc20",
  },
};

export const CardKrc20: Story = {
  args: {
    variant: "card",
    name: "NACHO",
    subtitle: "$0.230",
    amount: "1,233,608.327873",
    amountFiat: "≈ $51.419 USD",
    network: "krc20",
  },
};

export const CardHiddenBalance: Story = {
  args: { ...CardKcc20.args, amount: "*****", amountFiat: "≈ $*****" },
};

export const ListKcc20: Story = {
  args: {
    name: "STICK",
    subtitle: "vn384gs...c83gd",
    amount: "2,235.454365",
    network: "kcc20",
  },
};

export const ListDisabled: Story = {
  args: { ...ListKcc20.args, disabled: true },
};
