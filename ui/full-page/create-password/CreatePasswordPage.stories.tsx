import type { Meta, StoryObj } from "@storybook/react";
import CreatePasswordPage from "./CreatePasswordPage";

const meta: Meta<typeof CreatePasswordPage> = {
  title: "Pages/CreatePassword",
  component: CreatePasswordPage,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "fullscreen" },
  },
  argTypes: {
    title: { control: "text" },
    subtitle: { control: "text" },
    passwordLabel: { control: "text" },
    confirmPasswordLabel: { control: "text" },
    passwordPlaceholder: { control: "text" },
    confirmPasswordPlaceholder: { control: "text" },
    hint: { control: "text" },
    buttonLabel: { control: "text" },
    error: { control: "text" },
    onBack: { action: "back" },
    onSubmit: { action: "submit" },
  },
};

export default meta;
type Story = StoryObj<typeof CreatePasswordPage>;

export const Default: Story = {};

export const CreateWallet: Story = {
  args: {
    title: "Create Password",
    buttonLabel: "Create wallet",
  },
};

export const WithError: Story = {
  args: {
    error: "Passwords do not match",
  },
};
