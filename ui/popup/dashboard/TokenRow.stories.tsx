import type { Meta, StoryObj } from "@storybook/react";
import TokenRow from "./TokenRow";

// The dashboard's KCC-20 row body, in the row frame and inset the popup uses.
const meta: Meta<typeof TokenRow> = {
  title: "Popup/Dashboard/TokenRow",
  component: TokenRow,
  decorators: [
    (Story) => (
      <div className="w-[375px] bg-icy-blue-950 px-3 py-4 font-sans">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 text-left hover:border-white"
        >
          <Story />
        </button>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TokenRow>;

/** KRON: registry metadata, priced by its market. */
export const Kron: Story = {
  args: {
    ticker: "WHALE",
    price: "$0.00000232",
    balance: "128,001",
    fiat: "≈ $0.30",
  },
};

/** Standard with known decimals and a kascov market: same shape as KRON. */
export const StandardPriced: Story = {
  args: {
    ticker: "NACHO",
    price: "$0.000231",
    balance: "2,107.593",
    fiat: "≈ $0.49",
  },
};

/** Standard without decimals: no scale, so no price and no fiat line. */
export const StandardUnknownDecimals: Story = {
  args: {
    ticker: "NACHO",
    balance: "200,759,267,306 base units",
    compactBalance: "200.76B base units",
  },
};

/** Nameless token: the short id stands in for the ticker. */
export const ShortIdTicker: Story = {
  args: {
    ticker: <span className="font-mono">abababab...babab</span>,
    balance: "210,759,267,306 base units",
    compactBalance: "210.76B base units",
  },
};

export const HiddenBalance: Story = {
  args: { ...Kron.args, balance: "*****", fiat: "≈ $*****" },
};
