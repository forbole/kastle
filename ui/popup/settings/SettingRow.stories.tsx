import type { Meta, StoryObj } from "@storybook/react";
import SettingRow from "./SettingRow";

const meta: Meta<typeof SettingRow> = {
  title: "Popup/Settings/Components/SettingRow",
  component: SettingRow,
  decorators: [
    (Story) => (
      <div className="w-[340px] bg-icy-blue-950 p-4 font-sans">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onClick: { action: "click" },
  },
};

export default meta;
type Story = StoryObj<typeof SettingRow>;

export const Default: Story = {
  args: {
    label: "Custom RPC",
    value: "Default",
  },
};

export const ActiveValue: Story = {
  args: {
    label: "Network",
    value: "Mainnet",
    valueColor: "text-teal-500",
  },
};

export const WithChevron: Story = {
  args: {
    label: "Change Password",
    showChevron: true,
  },
};
