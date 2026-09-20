export function createZKasApprovalSession(
  pageRequestId: string,
  origin: string,
) {
  return {
    pageRequestId,
    origin,
    approvalId: crypto.randomUUID(),
  };
}
