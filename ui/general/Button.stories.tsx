import type { Meta, StoryObj } from "@storybook/react";
import Button from "./Button";

const meta: Meta<typeof Button> = {
  title: "General/Button",
  component: Button,
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
type Story = StoryObj<typeof Button>;

export const PrimaryMd: Story = {
  args: {
    children: "Done",
    variant: "primary",
    size: "md",
  },
};

export const PrimaryLg: Story = {
  args: {
    children: "Add",
    variant: "primary",
    size: "lg",
  },
};

export const SecondaryMd: Story = {
  args: {
    children: "Add custom node",
    variant: "secondary",
    size: "md",
  },
};

export const Disabled: Story = {
  args: {
    children: "Add",
    variant: "primary",
    size: "lg",
    disabled: true,
  },
};

export const Loading: Story = {
  args: {
    children: "Add",
    variant: "primary",
    size: "lg",
    loading: true,
  },
};
