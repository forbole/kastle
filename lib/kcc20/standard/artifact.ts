import { bytesToHex } from "@noble/hashes/utils";
import { bytesEqual } from "./primitives";
import { STATE_LEN, TRANSFER_DELEGATOR_TAG, TRANSFER_TAG } from "./state";

// Reads the KCC20 template view out of an Argent program artifact. The template hash is NOT
// recomputed (the KCC-1 preimage is unresolved), so every view is `verified: false` and must not
// be trusted to define ownership.

export type ArtifactFieldType =
  | { kind: "int" }
  | { kind: "byte" }
  | { kind: "fixed_bytes"; len: number };

export type ArtifactField = { name: string; type: ArtifactFieldType };

export type Kcc20TemplateView = {
  contract: string;
  templateId: string;
  // Hex, as embedded in the template prefix (`6b 20 <hash>`).
  templateHash: string;
  prefix: Uint8Array;
  suffix: Uint8Array;
  stateSpan: { offset: number; len: number };
  // Absolute offset of the 112-byte KCC20State inside R.
  stateOffset: number;
  fields: ArtifactField[];
  dispatchTags: { transfer: string; transferDelegator: string };
  verified: false;
};

export class Kcc20ArtifactError extends Error {}

const TEMPLATE_HASH_LEN = 32;

// The only runtime state this wallet understands: the leading template-hash context field, then
// KCC20State in declaration order.
const EXPECTED_RECORD_FIELDS: ArtifactField[] = [
  { name: "amount", type: { kind: "int" } },
  { name: "owner", type: { kind: "fixed_bytes", len: 32 } },
  { name: "owner_scheme", type: { kind: "byte" } },
  { name: "borrow_scheme", type: { kind: "byte" } },
  { name: "borrow_guard", type: { kind: "fixed_bytes", len: 32 } },
  { name: "extension_commitment", type: { kind: "fixed_bytes", len: 32 } },
];

type Json = Record<string, unknown>;

function fail(message: string): never {
  throw new Kcc20ArtifactError(message);
}

function obj(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${path} must be an object`);
  return value as Json;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string") fail(`${path} must be a string`);
  return value;
}

function uint(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${path} must be a non-negative integer`);
  }
  return value;
}

function bytes(value: unknown, path: string): Uint8Array {
  const list = arr(value, path);
  const out = new Uint8Array(list.length);
  list.forEach((b, i) => {
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 0xff)
      fail(`${path}[${i}] is not a byte`);
    out[i] = b;
  });
  return out;
}

function fieldType(value: unknown, path: string): ArtifactFieldType {
  const t = obj(value, path);
  const kind = str(t.kind, `${path}.kind`);
  if (kind === "int" || kind === "byte") return { kind };
  if (kind === "fixed_bytes") return { kind, len: uint(t.len, `${path}.len`) };
  return fail(`${path}.kind ${kind} is not a KCC20State field type`);
}

function sameField(a: ArtifactField, b: ArtifactField) {
  if (a.name !== b.name || a.type.kind !== b.type.kind) return false;
  return (
    a.type.kind !== "fixed_bytes" ||
    (b.type.kind === "fixed_bytes" && a.type.len === b.type.len)
  );
}

export function parseArtifact(
  json: unknown,
  contractName = "KCC20",
): Kcc20TemplateView {
  const root = obj(json, "artifact");
  const contracts = obj(
    obj(root.sil_abi, "sil_abi").contracts,
    "sil_abi.contracts",
  );
  const base = `sil_abi.contracts.${contractName}`;
  const contract = obj(contracts[contractName], base);

  const fields = arr(
    obj(contract.runtime_state, `${base}.runtime_state`).fields,
    `${base}.runtime_state.fields`,
  ).map((f, i): ArtifactField => {
    const field = obj(f, `${base}.runtime_state.fields[${i}]`);
    return {
      name: str(field.name, `${base}.runtime_state.fields[${i}].name`),
      type: fieldType(field.type, `${base}.runtime_state.fields[${i}].type`),
    };
  });

  const templates = arr(
    obj(obj(root.argent, "argent").template_plan, "argent.template_plan")
      .templates,
    "argent.template_plan.templates",
  ).map((t, i) => obj(t, `argent.template_plan.templates[${i}]`));
  const matching = templates.filter((t) => t.contract === contractName);
  if (matching.length !== 1)
    fail(
      `expected exactly one template for ${contractName}, found ${matching.length}`,
    );
  const template = matching[0];
  const templateId = str(template.id, "template.id");
  const symbol = str(template.symbol, "template.symbol");
  const handle = obj(
    obj(template.actor_type_handle, "template.actor_type_handle").template,
    "template.actor_type_handle.template",
  );
  const prefix = bytes(handle.prefix, "template.prefix");
  const suffix = bytes(handle.suffix, "template.suffix");

  const [contextField, ...recordFields] = fields;
  const expectedContext: ArtifactField = {
    name: symbol,
    type: { kind: "fixed_bytes", len: TEMPLATE_HASH_LEN },
  };
  if (
    !contextField ||
    !sameField(contextField, expectedContext) ||
    recordFields.length !== EXPECTED_RECORD_FIELDS.length ||
    !recordFields.every((f, i) => sameField(f, EXPECTED_RECORD_FIELDS[i]))
  ) {
    fail(`${base}.runtime_state.fields is not [template, KCC20State]`);
  }

  const compiled = obj(contract.compiled, `${base}.compiled`);
  const span = obj(compiled.state_span, `${base}.compiled.state_span`);
  const stateSpan = {
    offset: uint(span.offset, "state_span.offset"),
    len: uint(span.len, "state_span.len"),
  };
  // The span covers the template-hash push (1 + 32 bytes) followed by the encoded record.
  if (stateSpan.len !== 1 + TEMPLATE_HASH_LEN + STATE_LEN)
    fail(`state_span.len ${stateSpan.len} is not 145`);

  const silTemplateHash = bytes(
    template.sil_template_hash,
    "template.sil_template_hash",
  );
  const compiledTemplateHash = bytes(
    compiled.template_hash,
    `${base}.compiled.template_hash`,
  );
  const stateOffset = stateSpan.offset + 1 + TEMPLATE_HASH_LEN;
  if (
    silTemplateHash.length !== TEMPLATE_HASH_LEN ||
    !bytesEqual(silTemplateHash, compiledTemplateHash) ||
    prefix.length !== stateOffset ||
    prefix[0] !== 0x6b ||
    prefix[stateSpan.offset] !== 0x20 ||
    !bytesEqual(prefix.subarray(stateSpan.offset + 1), silTemplateHash)
  ) {
    fail(
      "template prefix is not OP_TOALTSTACK || push32(template_hash) at state_span",
    );
  }

  const entries = obj(contract.entries, `${base}.entries`);
  const tagOf = (entry: string) =>
    str(
      obj(entries[entry], `${base}.entries.${entry}`).dispatch_tag,
      `${base}.entries.${entry}.dispatch_tag`,
    );
  const dispatchTags = {
    transfer: tagOf("transfer"),
    transferDelegator: tagOf("transfer_delegator"),
  };
  if (dispatchTags.transfer !== bytesToHex(TRANSFER_TAG))
    fail("transfer dispatch_tag does not match the signature");
  if (dispatchTags.transferDelegator !== bytesToHex(TRANSFER_DELEGATOR_TAG)) {
    fail("transfer_delegator dispatch_tag does not match the signature");
  }

  return {
    contract: contractName,
    templateId,
    templateHash: bytesToHex(silTemplateHash),
    prefix,
    suffix,
    stateSpan,
    stateOffset,
    fields,
    dispatchTags,
    verified: false,
  };
}
