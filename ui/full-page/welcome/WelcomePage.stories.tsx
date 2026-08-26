import type { Meta, StoryObj } from "@storybook/react";
import WelcomePage from "./WelcomePage";

const meta: Meta<typeof WelcomePage> = {
  title: "Pages/Welcome",
  component: WelcomePage,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "fullscreen" },
  },
  argTypes: {
    subtitle: { control: "text" },
    title: { control: "text" },
    primaryButtonLabel: { control: "text" },
    secondaryButtonLabel: { control: "text" },
    onPrimaryClick: { action: "primaryClicked" },
    onSecondaryClick: { action: "secondaryClicked" },
  },
};

export default meta;
type Story = StoryObj<typeof WelcomePage>;

export const Default: Story = {};

export const CustomText: Story = {
  args: {
    subtitle: "歡迎使用 Kastle",
    title: "您的安全快速 Kaspa 錢包",
    primaryButtonLabel: "建立新錢包",
    secondaryButtonLabel: "匯入現有錢包",
  },
};
