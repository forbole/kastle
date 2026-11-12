import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import kasplexIcon from "@/assets/images/network-logos/kasplex.svg";
import igraIcon from "@/assets/images/network-logos/igra.svg";
import ManageAssetsPage, {
  MANAGE_ASSETS_LABELS,
  ManageAssetsToken,
} from "./ManageAssetsPage";

const meta: Meta<typeof ManageAssetsPage> = {
  title: "Popup/ManageAssets/Screens/ManageAssetsPage",
  component: ManageAssetsPage,
  parameters: { layout: "centered" },
  argTypes: {
    onToggle: { action: "toggle" },
    onBack: { action: "back" },
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
type Story = StoryObj<typeof ManageAssetsPage>;

const KAS: ManageAssetsToken = {
  id: "kas",
  name: "KAS",
  logo: kasIcon,
  balance: "1,000 KAS",
  visible: true,
  locked: true,
  lockedReason: MANAGE_ASSETS_LABELS.nativeLocked,
};

const KAS_L2: ManageAssetsToken = {
  id: "kas-kasplex",
  name: "KAS",
  logo: kasIcon,
  chainBadge: kasplexIcon,
  chainLabel: "Kasplex L2",
  balance: "1,000 KAS",
  visible: true,
  locked: true,
  lockedReason: MANAGE_ASSETS_LABELS.nativeLocked,
};

const KAS_IGRA: ManageAssetsToken = {
  ...KAS_L2,
  id: "kas-igra",
  chainBadge: igraIcon,
  chainLabel: "Igra L2",
};

function token(
  id: string,
  name: string,
  chain: "kaspa" | "igra" | "kasplex",
  visible: boolean,
): ManageAssetsToken {
  const badges = {
    kaspa: { chainBadge: kasIcon, chainLabel: "Kaspa L1" },
    igra: { chainBadge: igraIcon, chainLabel: "Igra L2" },
    kasplex: { chainBadge: kasplexIcon, chainLabel: "Kasplex L2" },
  };
  return {
    id,
    name,
    logo: kasIcon,
    balance: `1,000 ${name}`,
    visible,
    ...badges[chain],
  };
}

const MORE: ManageAssetsToken[] = [
  token("kango", "KANGO", "kaspa", false),
  token("kasper", "KASPER", "igra", true),
  token("kaspy", "KASPY", "kaspa", true),
  token("nacho-kasplex", "NACHO", "kasplex", false),
  token("nacho", "NACHO", "kaspa", false),
  token("szar", "SZAR", "kaspa", false),
  token("szar-igra", "SZAR", "igra", false),
];

// Real toggling: the switches flip. The parent decides which rows are locked.
function Interactive({ initial }: { initial: ManageAssetsToken[] }) {
  const [tokens, setTokens] = useState(initial);
  return (
    <ManageAssetsPage
      tokens={tokens}
      onToggle={(id, visible) =>
        setTokens((list) =>
          list.map((t) => (t.id === id ? { ...t, visible } : t)),
        )
      }
      onBack={() => {}}
    />
  );
}

/** KAS on every network is locked: switch disabled, hover or focus it to see why. Other tokens toggle. */
export const Default: Story = {
  render: () => (
    <Interactive initial={[KAS, KAS_L2, KAS_IGRA, MORE[0], MORE[1]]} />
  ),
};

/** Scrolls inside the list; the header stays. Hover a corner badge to see the chain name. */
export const LongList: Story = {
  render: () => (
    <Interactive
      initial={[
        KAS,
        KAS_L2,
        KAS_IGRA,
        ...MORE,
        ...MORE.map((t) => ({ ...t, id: `${t.id}-2` })),
      ]}
    />
  ),
};
