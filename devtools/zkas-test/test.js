const byId = (id) => document.getElementById(id);
byId("origin").textContent = window.location.origin;

function provider() {
  const kastle = window.kastle;
  if (!kastle || typeof kastle.request !== "function") {
    throw new Error("Kastle was not detected. Load the local extension and refresh this page.");
  }
  return kastle;
}

function show(id, value, error = false) {
  const node = byId(id);
  node.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  node.classList.toggle("error", error);
}

function refreshProvider() {
  byId("provider").textContent = window.kastle?.request
    ? "Kastle provider detected"
    : "Kastle provider not detected";
}

window.addEventListener("kastle#initialized", refreshProvider);
refreshProvider();

async function invoke(id, method, args) {
  show(id, `Waiting for ${method}…`);
  try {
    const result = await provider().request(method, args);
    show(id, result === undefined ? "No result returned" : result);
  } catch (error) {
    show(id, error instanceof Error ? error.message : String(error), true);
  }
}

byId("probe").addEventListener("click", () => invoke("connection-output", "kas:get_version"));
byId("connect").addEventListener("click", () => invoke("connection-output", "zkas:connect"));
byId("account").addEventListener("click", () => invoke("read-output", "zkas:get_account"));
byId("balance").addEventListener("click", () => invoke("read-output", "zkas:get_balance"));
byId("send").addEventListener("click", () => {
  const to = byId("recipient").value.trim();
  const amount = byId("amount").value.trim();
  const maxFee = byId("fee").value.trim();
  invoke("send-output", "zkas:send", { to, amount, maxFee });
});
