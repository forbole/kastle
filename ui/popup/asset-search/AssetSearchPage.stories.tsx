import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import nftPlaceholder from "@/assets/images/nft-placeholder.png";
import AssetSearchPage, { AssetSearchItem } from "./AssetSearchPage";

const meta: Meta<typeof AssetSearchPage> = {
  title: "Popup/AssetSearch/Screens/AssetSearchPage",
  component: AssetSearchPage,
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
};

export default meta;
type Story = StoryObj<typeof AssetSearchPage>;

const nachoKcc20: AssetSearchItem = {
  id: "nacho-kcc20",
  name: "NACHO",
  kind: "asset",
  network: "kcc20",
};
const nachoKasplex: AssetSearchItem = {
  id: "nacho-kasplex",
  name: "NACHO",
  kind: "asset",
  network: "kasplexErc20",
};
const nft3857: AssetSearchItem = {
  id: "nacho-3857",
  name: "NACHO #3857",
  kind: "nft",
  logo: nftPlaceholder,
};
const nft4795: AssetSearchItem = {
  id: "freenacho-4795",
  name: "FREENACHO #4795",
  kind: "nft",
  logo: nftPlaceholder,
};

const recentItems = [nachoKcc20, nachoKasplex, nft3857, nft4795];

function Template({
  initialQuery = "",
  initialRecent = [],
  results = [],
  isLoading,
}: {
  initialQuery?: string;
  initialRecent?: AssetSearchItem[];
  results?: AssetSearchItem[];
  isLoading?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [recent, setRecent] = useState(initialRecent);
  return (
    <AssetSearchPage
      query={query}
      onQueryChange={setQuery}
      onBack={() => {}}
      recent={recent}
      results={results}
      isLoading={isLoading}
      onSelect={() => {}}
      onRemoveRecent={(item) =>
        setRecent((list) => list.filter((r) => r.id !== item.id))
      }
    />
  );
}

/** First visit: nothing searched yet. */
export const Default: Story = { render: () => <Template /> };

export const Recent: Story = {
  render: () => <Template initialRecent={recentItems} />,
};

/** Two results in, more still loading. */
export const Loading: Story = {
  render: () => (
    <Template initialQuery="N" results={[nachoKcc20, nachoKasplex]} isLoading />
  ),
};

export const Filled: Story = {
  render: () => (
    <Template
      initialQuery="NACHO"
      results={[nachoKcc20, nachoKasplex, nft3857, nft4795]}
    />
  ),
};

export const Empty: Story = {
  render: () => <Template initialQuery="ORANGE" />,
};
