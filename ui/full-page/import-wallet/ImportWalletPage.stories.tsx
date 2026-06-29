import type { Meta, StoryObj } from "@storybook/react";
import ImportWalletPage from "./ImportWalletPage";

const meta: Meta<typeof ImportWalletPage> = {
  title: "Pages/ImportWallet",
  component: ImportWalletPage,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "fullscreen" },
  },
  argTypes: {
    title: { control: "text" },
    createWalletLabel: { control: "text" },
    onBack: { action: "back" },
    onClose: { action: "close" },
    onCreateWallet: { action: "createWallet" },
  },
};

export default meta;
type Story = StoryObj<typeof ImportWalletPage>;

export const Default: Story = {};

export const NoAdvanced: Story = {
  args: {
    advancedMethods: [],
  },
};
