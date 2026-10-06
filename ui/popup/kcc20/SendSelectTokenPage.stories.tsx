import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import SendSelectTokenPage, {
  ALL_NETWORK_FILTERS,
  SendSelectToken,
} from "./SendSelectTokenPage";
import type { NetworkFilter } from "./labels";

const meta: Meta<typeof SendSelectTokenPage> = {
  title: "Popup/Kcc20/Screens/SendSelectTokenPage",
  component: SendSelectTokenPage,
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
type Story = StoryObj<typeof SendSelectTokenPage>;

const tokens: SendSelectToken[] = [
  { id: "kas", name: "Kaspa", amount: "2,000.947324", network: "kaspa" },
  {
    id: "stick",
    name: "STICK",
    subtitle: "vn384gs...c83gd",
    amount: "2,235.454365",
    network: "kcc20",
  },
  {
    id: "szar",
    name: "SZAR",
    subtitle: "1663d3...3c5dek",
    amount: "3,250.785432",
    network: "kcc20",
  },
  { id: "nacho-krc20", name: "NACHO", amount: "12,345", network: "krc20" },
  {
    id: "nacho-kasplex",
    name: "NACHO",
    subtitle: "0x1663d3...3c5dek",
    amount: "2,500,000,000",
    network: "kasplexErc20",
  },
  {
    id: "kasper-igra",
    name: "KASPER",
    subtitle: "0x9a1f2c...77e0ab",
    amount: "6,789.123456",
    network: "igraErc20",
  },
];

function Template({
  initialQuery = "",
  initialFilters = ALL_NETWORK_FILTERS,
  isLoading,
  tokenList = tokens,
}: {
  initialQuery?: string;
  initialFilters?: NetworkFilter[];
  isLoading?: boolean;
  tokenList?: SendSelectToken[];
}) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedFilters, setSelectedFilters] = useState(initialFilters);
  return (
    <SendSelectTokenPage
      tokens={tokenList}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      selectedFilters={selectedFilters}
      onFiltersChange={setSelectedFilters}
      onTokenSelect={() => {}}
      isLoading={isLoading}
    />
  );
}

export const Default: Story = { render: () => <Template /> };

export const Typing: Story = { render: () => <Template initialQuery="na" /> };

export const KaspaWithKcc20: Story = {
  render: () => <Template initialFilters={["kaspa"]} />,
};

export const MultiSelect: Story = {
  render: () => <Template initialFilters={["kasplex", "igra"]} />,
};

export const Loading: Story = {
  render: () => <Template tokenList={[]} isLoading />,
};
