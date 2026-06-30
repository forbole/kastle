import type { Meta, StoryObj } from "@storybook/react";
import ImportPassphrasePage from "./ImportPassphrasePage";

const meta: Meta<typeof ImportPassphrasePage> = {
  title: "Pages/ImportPassphrase",
  component: ImportPassphrasePage,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "fullscreen" },
  },
  argTypes: {
    title: { control: "text" },
    subtitle: { control: "text" },
    passphraseLabel: { control: "text" },
    passphrasePlaceholder: { control: "text" },
    passphraseInfoLabel: { control: "text" },
    buttonLabel: { control: "text" },
    isLoading: { control: "boolean" },
    error: { control: "text" },
    onBack: { action: "back" },
    onSubmit: { action: "submit" },
  },
};

export default meta;
type Story = StoryObj<typeof ImportPassphrasePage>;

export const Default: Story = {};

export const Loading: Story = {
  args: { isLoading: true },
};

export const WithError: Story = {
  args: { error: "Incorrect passphrase" },
};
