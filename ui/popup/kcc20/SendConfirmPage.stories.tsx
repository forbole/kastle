import type { Meta, StoryObj } from "@storybook/react";
import signImage from "@/assets/images/sign.png";
import SendConfirmPage from "./SendConfirmPage";

const meta: Meta<typeof SendConfirmPage> = {
  title: "Popup/Kcc20/Screens/SendConfirmPage",
  component: SendConfirmPage,
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
    onConfirm: { action: "confirm" },
    onBack: { action: "back" },
    onClose: { action: "close" },
    onEstFeePress: { action: "est fee" },
  },
};

export default meta;
type Story = StoryObj<typeof SendConfirmPage>;

export const Kcc20: Story = {
  args: {
    illustration: signImage,
    senderAddress:
      "kaspa:feevxs00fycp9v7tjcjsgcj5jttkqe7t7vdfxfradj8283gk7cu9tr7vur7",
    recipientAddress:
      "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz",
    network: "kcc20",
    amount: "1,608.32787 NACHO",
    amountFiat: "≈ $24,000 USD",
    estFee: "0.423354 KAS",
    estFeeFiat: "≈ $1.345 USD",
  },
};

export const Krc20: Story = {
  args: { ...Kcc20.args, network: "krc20" },
};

export const Kaspa: Story = {
  args: {
    ...Kcc20.args,
    network: "kaspa",
    amount: "1,000 KAS",
    amountFiat: "≈ $230 USD",
    estFee: "0.0001 KAS",
    estFeeFiat: "≈ $0.023 USD",
  },
};

export const Signing: Story = {
  args: { ...Kcc20.args, isConfirmLoading: true },
};

export const ConfirmDisabled: Story = {
  args: { ...Kcc20.args, isConfirmDisabled: true, onEstFeePress: undefined },
};
