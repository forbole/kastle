import { expect, test } from "@playwright/test";
import { signTypedDataSchema } from "@/lib/ethereum/typed-data";

const TYPED_DATA = {
  types: {
    EIP712Domain: [{ name: "name", type: "string" }],
    Mail: [{ name: "contents", type: "string" }],
  },
  primaryType: "Mail",
  domain: { name: "Ether Mail" },
  message: { contents: "Hello" },
};

test.describe("signTypedDataSchema", () => {
  test("accepts the EIP-712 payload as a JSON string", () => {
    const result = signTypedDataSchema.safeParse(JSON.stringify(TYPED_DATA));
    expect(result.success).toBe(true);
    expect(result.data).toEqual(TYPED_DATA);
  });

  test("accepts the EIP-712 payload as an object", () => {
    const result = signTypedDataSchema.safeParse(TYPED_DATA);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(TYPED_DATA);
  });

  test("object and string inputs normalize to the same canonical JSON", () => {
    const fromString = signTypedDataSchema.parse(JSON.stringify(TYPED_DATA));
    const fromObject = signTypedDataSchema.parse(TYPED_DATA);
    expect(JSON.stringify(fromObject)).toBe(JSON.stringify(fromString));
  });

  test("rejects a non-JSON string instead of throwing", () => {
    const result = signTypedDataSchema.safeParse("[object Object]");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Typed data is not valid JSON",
    );
  });

  test("rejects payloads missing EIP-712 fields", () => {
    expect(signTypedDataSchema.safeParse({ foo: "bar" }).success).toBe(false);
    expect(signTypedDataSchema.safeParse('"just a string"').success).toBe(
      false,
    );
    expect(signTypedDataSchema.safeParse(42).success).toBe(false);
    expect(signTypedDataSchema.safeParse(null).success).toBe(false);
  });
});
