import type { Meta, StoryObj } from "@storybook/react";
import ImportRecoveryPhrasePage from "./ImportRecoveryPhrasePage";

const meta: Meta<typeof ImportRecoveryPhrasePage> = {
  title: "Pages/ImportRecoveryPhrase",
  component: ImportRecoveryPhrasePage,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "fullscreen" },
  },
  argTypes: {
    title: { control: "text" },
    subtitle: { control: "text" },
    buttonLabel: { control: "text" },
    passphraseInfoLabel: { control: "text" },
    isLoading: { control: "boolean" },
    error: { control: "text" },
    onBack: { action: "back" },
    onErrorClear: { action: "errorClear" },
    onSubmit: { action: "submit" },
  },
};

export default meta;
type Story = StoryObj<typeof ImportRecoveryPhrasePage>;

export const Default: Story = {};

export const Loading: Story = {
  args: { isLoading: true },
};

export const WithError: Story = {
  args: { error: "Oh, the recovery phrase is invalid" },
};

export const NoPassphrase: Story = {
  args: { hasPassphrase: false },
};
