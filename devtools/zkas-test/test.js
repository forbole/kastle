const byId = (id) => document.getElementById(id);
byId("origin").textContent = window.location.origin;

function provider() {
  const kastle = window.kastle;
  if (!kastle || typeof kastle.request !== "function") {
    throw new Error(
      "Kastle was not detected. Load the local extension and refresh this page.",
    );
  }
  return kastle;
}

function show(id, value, error = false) {
  const node = byId(id);
  node.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  node.classList.toggle("error", error);
}

function refreshProvider() {
  const detected = typeof window.kastle?.request === "function";
  byId("provider").textContent = detected
    ? "Kastle provider detected"
    : "Kastle provider not detected";
  return detected;
}

window.addEventListener("kastle#initialized", refreshProvider);
refreshProvider();
const detectionTimer = setInterval(() => {
  if (refreshProvider()) clearInterval(detectionTimer);
}, 250);
setTimeout(() => clearInterval(detectionTimer), 5_000);

async function invoke(id, method, args) {
  show(id, `Waiting for ${method}…`);
  try {
    const result = await provider().request(method, args);
    show(id, result === undefined ? "No result returned" : result);
  } catch (error) {
    show(id, error instanceof Error ? error.message : String(error), true);
  }
}

function toSompi(value, label) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) throw new Error(`${label} needs at most 8 decimal places`);
  const sompi =
    BigInt(match[1]) * 100000000n + BigInt((match[2] ?? "").padEnd(8, "0"));
  if (sompi <= 0n || sompi > 18446744073709551615n)
    throw new Error(`${label} is out of range`);
  return sompi.toString();
}

byId("probe").addEventListener("click", () =>
  invoke("connection-output", "kas:get_version"),
);
byId("connect").addEventListener("click", () =>
  invoke("connection-output", "zkas:connect"),
);
byId("account").addEventListener("click", () =>
  invoke("read-output", "zkas:get_account"),
);
byId("balance").addEventListener("click", () =>
  invoke("read-output", "zkas:get_balance"),
);
byId("send").addEventListener("click", () => {
  try {
    const to = byId("recipient").value.trim();
    const amountSompi = toSompi(byId("amount").value.trim(), "Amount");
    const maxFeeSompi = toSompi(byId("fee").value.trim(), "Maximum fee");
    void invoke("send-output", "zkas:send", { to, amountSompi, maxFeeSompi });
  } catch (error) {
    show(
      "send-output",
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
});
