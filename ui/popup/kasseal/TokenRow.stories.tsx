import type { Meta, StoryObj } from "@storybook/react";
import TokenRow from "./TokenRow";

const meta: Meta<typeof TokenRow> = {
  title: "Popup/Kasseal/Components/TokenRow",
  component: TokenRow,
  decorators: [
    (Story) => (
      <div className="w-[375px] bg-icy-blue-950 p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TokenRow>;

export const Bonding: Story = {
  args: {
    name: "Seal",
    ticker: "SEAL",
    progress: 42.5,
    marketCap: "12,345 KAS",
    onClick: () => {},
  },
};
export const Graduated: Story = {
  args: { name: "Seal", ticker: "SEAL", marketCap: "1,234,567 KAS" },
};
