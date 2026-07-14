import type { Meta, StoryObj } from "@storybook/react";
import NodeListItem from "./NodeListItem";

const meta: Meta<typeof NodeListItem> = {
  title: "Popup/CustomRpc/Components/NodeListItem",
  component: NodeListItem,
  decorators: [
    (Story) => (
      <div className="w-[340px] bg-icy-blue-950 p-4 font-sans">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onSelect: { action: "select" },
    onRemove: { action: "remove" },
  },
};

export default meta;
type Story = StoryObj<typeof NodeListItem>;

export const DefaultSelected: Story = {
  args: {
    name: "Kastle node",
    url: "kastle-mainnet-borsh.rhyzome.co",
    isDefault: true,
    selected: true,
  },
};

export const CustomUnselected: Story = {
  args: {
    name: "Community node",
    url: "community-node.com",
    selected: false,
  },
};

export const EditModeCustom: Story = {
  args: {
    name: "Community node",
    url: "community-node.com",
    editMode: true,
  },
};

export const EditModeDefault: Story = {
  args: {
    name: "Kastle node",
    url: "kastle-mainnet-borsh.rhyzome.co",
    isDefault: true,
    editMode: true,
  },
};
