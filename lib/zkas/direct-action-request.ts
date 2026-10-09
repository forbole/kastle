import { z } from "zod";

const hex16 = z.string().regex(/^[0-9a-f]{32}$/);
const card184 = z.string().regex(/^[0-9a-f]{368}$/);
const utf8 = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine(
      (value) => new TextEncoder().encode(value).length <= maximum,
      "Direct action text exceeds UTF-8 limit",
    );
const invite = z.object({ publicCard: card184, note: utf8(33) }).strict();
const decision = z
  .object({
    inviterId: hex16,
    invitationActionId: hex16,
    decision: z.enum(["accept", "reject"]),
    note: utf8(32),
  })
  .strict();
const text = z
  .object({
    peerId: hex16,
    text: utf8(216).refine((value) => value.length > 0),
  })
  .strict();
const action = z.object({ actionId: hex16 }).strict();

export type DirectActionRequest =
  | ({ kind: "invite" } & z.infer<typeof invite>)
  | ({ kind: "decision" } & z.infer<typeof decision>)
  | ({ kind: "text" } & z.infer<typeof text>);

/** Public page input only; account, origin, network and fees are wallet-owned. */
export function parseDirectActionRequest(
  kind: DirectActionRequest["kind"],
  payload: unknown,
): DirectActionRequest {
  if (kind === "invite") return { kind, ...invite.parse(payload) };
  if (kind === "decision") return { kind, ...decision.parse(payload) };
  return { kind, ...text.parse(payload) };
}

export function parseDirectActionId(payload: unknown): string {
  return action.parse(payload).actionId;
}
