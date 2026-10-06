import type { Meta, StoryObj } from "@storybook/react";
import kasplexIcon from "@/assets/images/network-logos/kasplex.svg";
import igraIcon from "@/assets/images/network-logos/igra.svg";
import AssetImage from "./AssetImage";

const meta: Meta<typeof AssetImage> = {
  title: "Popup/Kcc20/Components/AssetImage",
  component: AssetImage,
  decorators: [
    (Story) => (
      <div className="bg-icy-blue-950 p-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AssetImage>;

export const Single: Story = { args: { variant: "single" } };

export const ChainKcc20: Story = {
  args: { variant: "chain", network: "kcc20" },
};

/** KRC-20 and native KAS carry no corner badge. */
export const ChainKrc20NoBadge: Story = {
  args: { variant: "chain", network: "krc20" },
};

export const ChainIgraErc20: Story = {
  args: { variant: "chain", network: "igraErc20" },
};

export const ChainDetailHeaderSize: Story = {
  args: {
    variant: "chain",
    network: "kcc20",
    tokenImageSize: 44,
    chainImageSize: 20,
  },
};

export const Dual: Story = {
  args: { variant: "dual", fromImage: kasplexIcon, chainImage: igraIcon },
};
