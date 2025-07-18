import { CommitRevealPayloadSchema } from "@/api/background/handlers/kaspa/commitReveal";
import CommitReveal from "./commit-reveal/CommitReveal";
import Splash from "../../Splash";

export default function CommitRevealConfirm() {
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? JSON.parse(decodeURIComponent(encodedPayload))
    : null;

  const parsedPayload = payload
    ? CommitRevealPayloadSchema.parse(payload)
    : null;

  return (
    <>
      <div className="no-scrollbar h-screen overflow-y-scroll p-4">
        {!parsedPayload && <Splash />}
        {parsedPayload && (
          <CommitReveal requestId={requestId} payload={parsedPayload} />
        )}
      </div>
    </>
  );
}
