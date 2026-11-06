import type { Meta, StoryObj } from "@storybook/react";
import AssetSendButton from "./AssetSendButton";

const meta: Meta<typeof AssetSendButton> = {
  title: "General/AssetSendButton",
  component: AssetSendButton,
  parameters: {
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#051d27" }],
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[375px] px-4 pb-4">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    ticker: { control: "text" },
    onClick: { action: "send" },
  },
};

export default meta;
type Story = StoryObj<typeof AssetSendButton>;

export const Default: Story = {
  args: { ticker: "KTEST" },
};
