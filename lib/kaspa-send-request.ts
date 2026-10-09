import { z } from "zod";

const MAX_SOMPI = 18_446_744_073_709_551_615n;
export const MAX_KASPA_SEND_OUTPUTS = 64;
const exactSompi = z
  .string()
  .max(20)
  .regex(/^(0|[1-9][0-9]*)$/)
  .pipe(
    z
      .string()
      .refine(
        (value) => BigInt(value) <= MAX_SOMPI,
        "Amount exceeds the sompi range",
      ),
  );
const payload = z
  .string()
  .refine(
    (value) => /^[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0,
    "payload must be a valid hex string (even length, 0-9 a-f only)",
  )
  .optional();

export const sendSompiPayloadSchema = z
  .object({
    toAddress: z.string().min(1),
    sompi: z.number().int().safe().min(20_000_000),
    options: z
      .object({
        priorityFee: z.number().int().safe().min(0).default(0),
        payload,
      })
      .strict()
      .default({}),
  })
  .strict();

export const sendKaspaManyPayloadSchema = z
  .object({
    outputs: z
      .array(
        z
          .object({
            address: z.string().min(1).max(200),
            amount: exactSompi.pipe(
              z
                .string()
                .refine(
                  (value) => BigInt(value) >= 20_000_000n,
                  "Each output must be at least 0.2 KAS",
                ),
            ),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_KASPA_SEND_OUTPUTS),
    options: z
      .object({
        priorityFee: exactSompi.default("0"),
        payload,
      })
      .strict()
      .default({}),
  })
  .strict()
  .refine(
    ({ outputs, options }) =>
      [options.priorityFee, ...outputs.map((output) => output.amount)].every(
        (value) => /^(0|[1-9][0-9]{0,19})$/.test(value),
      ) &&
      outputs.reduce(
        (sum, output) => sum + BigInt(output.amount),
        BigInt(options.priorityFee),
      ) <= MAX_SOMPI,
    "Total amount and priority fee exceed the sompi range",
  );

export function parseKaspaSendRequest(value: unknown) {
  const parsed = z
    .union([sendKaspaManyPayloadSchema, sendSompiPayloadSchema])
    .parse(value);
  if ("outputs" in parsed) return parsed;
  return {
    outputs: [{ address: parsed.toAddress, amount: parsed.sompi.toString() }],
    options: {
      ...parsed.options,
      priorityFee: parsed.options.priorityFee.toString(),
    },
  };
}
