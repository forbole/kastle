import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import { fn } from "storybook/test";
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
      // The shared asset header reads the router.
      <MemoryRouter>
        <div className="relative h-[600px] w-[375px] overflow-hidden bg-icy-blue-950 font-sans text-white">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  argTypes: {
    onBack: { action: "back" },
    onClose: { action: "close" },
    onTokenIdPress: { action: "copy token id" },
    onOpenExplorer: { action: "open explorer" },
    onSend: { action: "send" },
    onMigrate: { action: "migrate" },
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
  balance: "2,000 NACHO",
  priceLabel: "$0.00000799",
  valueLabel: "$0.016",
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

/** A sendable token: the shared pinned "Send {ticker}" action. */
export const SendableKcc20: Story = {
  render: (args) => (
    <Template
      {...base}
      {...args}
      initialTab="history"
      onSend={args.onSend ?? (() => {})}
    />
  ),
};

export const UnverifiedKcc20: Story = {
  render: (args) => <Template {...base} {...args} />,
};

/** Contract Address row, no Security row, no tick even if isVerified is set. */
export const Krc20: Story = {
  render: (args) => <Template {...base} {...args} network="krc20" isVerified />,
};

/** KRC-20 badge beside the name, "Migrate to KCC-20" above Send. */
export const Krc20CanMigrate: Story = {
  args: { onMigrate: fn() },
  render: (args) => (
    <Template
      {...base}
      {...args}
      network="krc20"
      tokenName="Nacho the Kat"
      canMigrate
      onSend={args.onSend ?? (() => {})}
    />
  ),
};

/** Same token, not migratable: no migrate button. */
export const Krc20CannotMigrate: Story = {
  render: (args) => (
    <Template
      {...base}
      {...args}
      network="krc20"
      tokenName="Nacho the Kat"
      canMigrate={false}
      onSend={args.onSend ?? (() => {})}
    />
  ),
};

/** Migratable but no handler passed: no migrate button. */
export const Krc20CanMigrateNoHandler: Story = {
  render: (args) => (
    <Template
      {...base}
      {...args}
      network="krc20"
      tokenName="Nacho the Kat"
      canMigrate
      onMigrate={undefined}
      onSend={args.onSend ?? (() => {})}
    />
  ),
};

/** Long ticker truncates; the KRC-20 badge stays whole. */
export const Krc20LongName: Story = {
  args: { onMigrate: fn() },
  render: (args) => (
    <Template
      {...base}
      {...args}
      name="SUPERLONGTOKENTICKERNAME"
      tokenName="Super Long Token Name That Keeps Going"
      network="krc20"
      canMigrate
      onSend={args.onSend ?? (() => {})}
    />
  ),
};

export const FullInfo: Story = {
  render: (args) => (
    <Template
      {...base}
      {...args}
      name="TTTT"
      priceLabel="$0.052"
      valueLabel="$104"
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

/** Mobile's Token info: identity block, then Network, Standard, Balance, Decimals, Covenant ID. */
export const MobileTokenInfo: Story = {
  render: (args) => (
    <Template
      {...base}
      {...args}
      name="WHALE"
      tokenName="Whale Token"
      balance="128,001 WHALE"
      decimal="0"
      tokenId="ca8a8ed8...94c04"
      onSend={args.onSend ?? (() => {})}
    />
  ),
};
