import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import TokenDetailPage, {
  TokenDetailPageProps,
  TokenDetailTab,
} from "./TokenDetailPage";

const meta: Meta<typeof TokenDetailPage> = {
  title: "Popup/Kcc20/Screens/TokenDetailPage",
  component: TokenDetailPage,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="relative h-[600px] w-[375px] overflow-hidden bg-icy-blue-950 font-sans text-white">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onBack: { action: "back" },
    onClose: { action: "close" },
    onTokenIdPress: { action: "copy token id" },
    onOpenExplorer: { action: "open explorer" },
  },
};

export default meta;
type Story = StoryObj<typeof TokenDetailPage>;

type TemplateProps = Omit<TokenDetailPageProps, "activeTab" | "onTabChange">;

function Template({
  initialTab = "assetInfo",
  ...props
}: TemplateProps & { initialTab?: TokenDetailTab }) {
  const [activeTab, setActiveTab] = useState<TokenDetailTab>(initialTab);
  return (
    <TokenDetailPage
      {...props}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    />
  );
}

const base: TemplateProps = {
  name: "NACHO",
  priceLabel: "$0.00041",
  network: "kcc20",
  networkName: "Kaspa",
  tokenId: "84b93d7f...48dj6",
};

export const VerifiedKcc20: Story = {
  render: (args) => <Template {...base} {...args} isVerified />,
};

export const HistoryTab: Story = {
  render: (args) => <Template {...base} {...args} initialTab="history" />,
};

export const UnverifiedKcc20: Story = {
  render: (args) => <Template {...base} {...args} />,
};

/** Contract Address row, no Security row, no tick even if isVerified is set. */
export const Krc20: Story = {
  render: (args) => <Template {...base} {...args} network="krc20" isVerified />,
};

export const FullInfo: Story = {
  render: (args) => (
    <Template
      {...base}
      {...args}
      name="TTTT"
      priceLabel="$0.052"
      isVerified
      totalMintedPercent="10%"
      totalMintedFraction="(2.5B / 25B)"
      mintCount="24% (480 /2,400)"
      holderCount="9,998,095"
      transferCount="9,998,095"
      preallocationAmount="1,000,000"
      defaultMintAmount="9,998,095"
      decimal="8"
      minter="kaspa:qpzp...pnwz"
    />
  ),
};

export const FullInfoKasplexErc20: Story = {
  render: (args) => (
    <Template
      {...base}
      {...args}
      network="kasplexErc20"
      networkName="Kasplex"
      tokenId="0x1663d3...3c5dek"
      decimal="18"
    />
  ),
};
