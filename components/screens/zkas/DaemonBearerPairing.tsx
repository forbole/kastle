import { useCallback, useEffect, useRef, useState } from "react";
import { Method } from "../../../lib/service/methods";
import { sendMessage } from "@/lib/utils";
import { canonicalHistoryDaemonOrigin } from "../../../lib/zkas/history-config";

type PairingRow = {
  origin: string;
  revision: string;
  sourceStatus: "current" | "stale" | "unconfigured";
};
type Reply = { error?: string };

export default function DaemonBearerPairing({
  draftOrigin,
}: {
  draftOrigin: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const draft = useRef(draftOrigin);
  draft.current = draftOrigin;
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const mounted = useRef(false);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<PairingRow[] | null>(null);
  const [validToken, setValidToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const eraseInput = useCallback(() => {
    if (input.current) input.current.value = "";
    setValidToken(false);
  }, []);

  const unlocked = async () => {
    const status = await sendMessage<{
      isInitialized?: boolean;
      isUnlocked?: boolean;
      error?: string;
    }>(Method.KEYRING_STATUS);
    return (
      status?.isInitialized === true &&
      status.isUnlocked === true &&
      !status.error
    );
  };

  const current = useCallback(
    (expected: number, expectedDraft: string) =>
      mounted.current &&
      generation.current === expected &&
      draft.current === expectedDraft,
    [],
  );

  const refresh = useCallback(
    async (expected = generation.current) => {
      const expectedDraft = draft.current;
      const sequence = ++refreshSequence.current;
      const latest = () =>
        current(expected, expectedDraft) &&
        refreshSequence.current === sequence;
      try {
        const response = await sendMessage<{ records?: PairingRow[] } & Reply>(
          Method.ZKAS_DAEMON_BEARER_LIST,
        );
        if (!latest()) return;
        const isUnlocked = await unlocked();
        if (!latest() || !isUnlocked) return;
        if (response.error || !Array.isArray(response.records))
          throw new Error("Pairing list unavailable");
        setRows(response.records);
        setError("");
      } catch {
        if (latest()) {
          setRows(null);
          setError(
            "Could not load saved daemon credentials. Unlock and retry.",
          );
        }
      }
    },
    [current],
  );

  useEffect(() => {
    generation.current++;
    refreshSequence.current++;
    eraseInput();
    setBusy(false);
    setNotice("");
    setError("");
  }, [draftOrigin, eraseInput]);

  useEffect(() => {
    mounted.current = true;
    const mountedInput = input.current;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const isReady = await unlocked();
        if (!active) return;
        if (!isReady) {
          readyRef.current = false;
          generation.current++;
          refreshSequence.current++;
          eraseInput();
          setRows(null);
          setBusy(false);
          setNotice("");
          setError("");
          setReady(false);
        } else {
          const newlyReady = !readyRef.current;
          readyRef.current = true;
          setReady(true);
          if (newlyReady) void refresh(generation.current);
        }
      } catch {
        if (active) {
          readyRef.current = false;
          generation.current++;
          refreshSequence.current++;
          eraseInput();
          setRows(null);
          setBusy(false);
          setNotice("");
          setError("");
          setReady(false);
        }
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2_000);
    return () => {
      active = false;
      mounted.current = false;
      clearInterval(timer);
      generation.current++;
      refreshSequence.current++;
      if (mountedInput) mountedInput.value = "";
      if (input.current) input.current.value = "";
    };
  }, [eraseInput, refresh]);

  const pair = async () => {
    const secret = input.current?.value ?? "";
    eraseInput();
    setNotice("");
    setError("");
    let origin: string;
    try {
      origin = canonicalHistoryDaemonOrigin(draftOrigin);
      if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error("Invalid credential");
    } catch {
      setError(
        "Enter an exact daemon origin and a 64-character lowercase token.",
      );
      return;
    }
    const serial = ++generation.current;
    const capturedDraft = draftOrigin;
    refreshSequence.current++;
    const address = new URL(origin);
    // Keep the browser's user-gesture permission request before the first await.
    const permission = browser.permissions.request({
      origins: [`${address.protocol}//${address.hostname}/*`],
    });
    setBusy(true);
    try {
      if (!(await permission)) throw new Error("Permission denied");
      if (!current(serial, capturedDraft))
        throw new Error("Pairing context changed");
      const beforeDispatchUnlocked = await unlocked();
      if (!current(serial, capturedDraft) || !beforeDispatchUnlocked)
        throw new Error("Pairing context changed");
      const result = await sendMessage<Reply & { present?: boolean }>(
        Method.ZKAS_DAEMON_BEARER_PAIR,
        { origin, bearer: secret },
      );
      if (!current(serial, capturedDraft))
        throw new Error("Pairing context changed");
      const afterDispatchUnlocked = await unlocked();
      if (!current(serial, capturedDraft) || !afterDispatchUnlocked)
        throw new Error("Pairing context changed");
      if (result.error || result.present !== true)
        throw new Error("Pairing failed");
      setNotice(
        "Credential saved for authenticated requests to this origin. Connect the wallet to validate the daemon and share its viewing key.",
      );
      await refresh(serial);
    } catch {
      if (current(serial, capturedDraft)) {
        setError(
          "Could not confirm the credential save. Refresh saved credentials before retrying.",
        );
      }
    } finally {
      if (current(serial, capturedDraft)) setBusy(false);
    }
  };

  const clear = async (row: PairingRow) => {
    const serial = ++generation.current;
    const capturedDraft = draftOrigin;
    refreshSequence.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const beforeDispatchUnlocked = await unlocked();
      if (!current(serial, capturedDraft) || !beforeDispatchUnlocked)
        throw new Error("Pairing context changed");
      const result = await sendMessage<Reply & { cleared?: boolean }>(
        Method.ZKAS_DAEMON_BEARER_CLEAR,
        { origin: row.origin, expectedRevision: row.revision },
      );
      if (!current(serial, capturedDraft))
        throw new Error("Pairing context changed");
      const afterDispatchUnlocked = await unlocked();
      if (!current(serial, capturedDraft) || !afterDispatchUnlocked)
        throw new Error("Pairing context changed");
      if (result.error || result.cleared !== true)
        throw new Error("Clear failed");
      setNotice("Saved daemon credential cleared.");
      await refresh(serial);
    } catch {
      if (current(serial, capturedDraft)) {
        await refresh(serial);
        if (current(serial, capturedDraft))
          setError("Could not clear that saved revision. Refresh and retry.");
      }
    } finally {
      if (current(serial, capturedDraft)) setBusy(false);
    }
  };

  return (
    <section
      aria-label="Daemon transport credential"
      className="space-y-2 pt-4"
    >
      <h2 className="font-semibold">Daemon transport credential</h2>
      <p className="text-xs text-daintree-400">
        Custom daemon operators may require a private bearer token. Kastle uses
        a saved token for authenticated requests to its exact origin. Saving it
        alone does not validate or connect the daemon.
      </p>
      <label className="block text-sm" htmlFor="zkas-daemon-bearer">
        Daemon bearer token
      </label>
      <input
        id="zkas-daemon-bearer"
        ref={input}
        type="password"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) =>
          setValidToken(/^[0-9a-f]{64}$/.test(event.currentTarget.value))
        }
        disabled={!ready || busy}
        className="w-full rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-white"
      />
      <button
        type="button"
        disabled={!ready || busy || !validToken}
        onClick={() => void pair()}
        className="rounded border border-daintree-700 px-3 py-2 text-sm disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save credential for this origin"}
      </button>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => void refresh()}
        className="ml-2 rounded border border-daintree-700 px-3 py-2 text-sm disabled:opacity-40"
      >
        Refresh saved credentials
      </button>
      {!ready && (
        <p className="text-xs text-daintree-400">
          Unlock Kastle to manage saved credentials.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-daintree-300">
          {notice}
        </p>
      )}
      {rows?.length === 0 && (
        <p className="text-xs text-daintree-400">
          No saved daemon credentials.
        </p>
      )}
      {rows?.map((row) => (
        <div
          key={row.revision}
          className="space-y-1 rounded-lg bg-daintree-800 p-3 text-xs"
        >
          <p className="break-all">{row.origin}</p>
          <p>
            Source: {row.sourceStatus}. Saved for authenticated requests;
            connection status is separate.
          </p>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => void clear(row)}
            className="rounded border border-daintree-700 px-2 py-1 disabled:opacity-40"
          >
            Clear saved credential
          </button>
        </div>
      ))}
    </section>
  );
}
