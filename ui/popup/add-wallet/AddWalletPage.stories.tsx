import type { Meta, StoryObj } from "@storybook/react";
import AddWalletPage from "./AddWalletPage";

const meta: Meta<typeof AddWalletPage> = {
  title: "Popup/AddWallet",
  component: AddWalletPage,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="h-[600px] w-[375px] overflow-hidden bg-icy-blue-950 font-sans text-white">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onBack: { action: "back" },
    onClose: { action: "close" },
  },
};

export default meta;
type Story = StoryObj<typeof AddWalletPage>;

export const Default: Story = {};

export const NoAdvanced: Story = {
  args: {
    advancedOptions: [],
  },
};
