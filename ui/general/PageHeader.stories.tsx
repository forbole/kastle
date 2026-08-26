import type { Meta, StoryObj } from "@storybook/react";
import PageHeader from "./PageHeader";

const meta: Meta<typeof PageHeader> = {
  title: "General/PageHeader",
  component: PageHeader,
  parameters: {
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#051d27" }],
    },
  },
  argTypes: {
    title: { control: "text" },
    subtitle: { control: "text" },
    showBack: { control: "boolean" },
    showClose: { control: "boolean" },
    onBack: { action: "back" },
    onClose: { action: "close" },
    onRightAction: { action: "rightAction" },
  },
};

export default meta;
type Story = StoryObj<typeof PageHeader>;

export const Default: Story = {
  args: {
    title: "Import wallet with...",
    showBack: true,
    showClose: false,
  },
};

export const WithClose: Story = {
  args: {
    title: "Setup Password",
    showBack: true,
    showClose: true,
  },
};

export const WithSubtitle: Story = {
  args: {
    title: "Setup Password",
    subtitle: "This password will be used to unlock your wallet",
    showBack: true,
    showClose: true,
  },
};

export const TitleOnly: Story = {
  args: {
    title: "Page Title",
    showBack: false,
    showClose: false,
  },
};

export const WithRightAction: Story = {
  args: {
    title: "Custom RPC",
    subtitle: "The node Kastle uses to reach Kaspa.",
    showBack: true,
    rightIcon: "hn hn-pencil",
  },
};
