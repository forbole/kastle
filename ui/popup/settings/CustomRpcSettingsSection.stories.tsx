import type { Meta, StoryObj } from "@storybook/react";
import CustomRpcSettingsSection from "./CustomRpcSettingsSection";

const meta: Meta<typeof CustomRpcSettingsSection> = {
  title: "Popup/Settings/Components/CustomRpcSettingsSection",
  component: CustomRpcSettingsSection,
  decorators: [
    (Story) => (
      <div className="w-[340px] bg-icy-blue-950 p-4 font-sans">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onNetworkClick: { action: "networkClick" },
    onCustomRpcClick: { action: "customRpcClick" },
  },
};

export default meta;
type Story = StoryObj<typeof CustomRpcSettingsSection>;

export const Default: Story = {
  args: {
    networkValue: "Mainnet",
    customRpcValue: "Default",
  },
};

export const CustomNodeActive: Story = {
  args: {
    networkValue: "Mainnet",
    customRpcValue: "Home node",
  },
};

export const LongNodeName: Story = {
  args: {
    networkValue: "Testnet",
    customRpcValue: "A very long node's name...",
  },
};
