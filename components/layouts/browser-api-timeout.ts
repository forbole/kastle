export type ZKasPopupPhase = { kind: "idle" | "busy" | "done"; at: number };

export function browserApiPopupDeadline(pathname: string, openedAt: number, phase: ZKasPopupPhase): number {
  if (pathname !== "/zkas-send") return openedAt + 180_000;
  if (phase.kind === "busy") return phase.at + 10 * 60_000;
  if (phase.kind === "done") return phase.at + 3 * 60_000;
  return openedAt + 5 * 60_000;
}
