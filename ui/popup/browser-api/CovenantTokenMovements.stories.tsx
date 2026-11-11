import type { Meta, StoryObj } from "@storybook/react";
import { CovenantTokenMovements } from "./CovenantTokenMovements";

const meta: Meta<typeof CovenantTokenMovements> = {
  title: "Popup/BrowserApi/CovenantTokenMovements",
  component: CovenantTokenMovements,
  decorators: [
    (Story) => (
      <div className="w-[375px] bg-icy-blue-950 p-4 font-sans text-white">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof CovenantTokenMovements>;

// Covenant ids and addresses from test/fixtures/kaspacom-signtx-repro.txt.
const movement = {
  inputIndex: 0,
  covenantId:
    "ae3a6563b6374dc14c2b1bcd399c38a157f97c5a215ec26d0c33dfeaff91e5b8",
  family: "kron-legacy" as const,
  symbol: "KRON",
  decimals: 8,
  amount: 12_500_000_000n,
  destinations: [
    {
      address:
        "kaspatest:ppm400cf87xmszgw5hum6t2jkdjuga4er2j5jzswmckgc5znv7x3u3k3tumez",
      outputIndex: 0,
    },
  ],
};

export const Leaving: Story = {
  args: {
    status: "ready",
    movements: [
      movement,
      {
        ...movement,
        inputIndex: 1,
        covenantId:
          "2c4c9e0f46a412391b26499b2f23a14c3d3a965624deafc11d72c5200340dd36",
        symbol: "",
        decimals: undefined,
        amount: 42n,
      },
    ],
  },
};

export const NothingLeaving: Story = {
  args: { status: "ready", movements: [] },
};

export const Loading: Story = {
  args: { status: "loading", movements: [] },
};

export const Failed: Story = {
  args: { status: "failed", movements: [] },
};
