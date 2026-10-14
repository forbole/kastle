import type { Meta, StoryObj } from "@storybook/react";
import NetworkTypeChip from "./NetworkTypeChip";
import { NETWORK_TYPE_LABELS, NetworkType } from "./labels";

const meta: Meta<typeof NetworkTypeChip> = {
  title: "Popup/Kcc20/Components/NetworkTypeChip",
  component: NetworkTypeChip,
  decorators: [
    (Story) => (
      <div className="bg-icy-blue-950 p-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NetworkTypeChip>;

export const Kcc20: Story = { args: { network: "kcc20" } };

export const Krc20: Story = { args: { network: "krc20" } };

export const AllNetworks: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      {(Object.keys(NETWORK_TYPE_LABELS) as NetworkType[]).map((network) => (
        <NetworkTypeChip key={network} network={network} />
      ))}
    </div>
  ),
};
