let tail: Promise<unknown> = Promise.resolve();

// Wallet payment reservations are made in the extension background context.
export function withZKasPaymentAccountGate<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = tail.then(operation);
  tail = result.catch(() => undefined);
  return result;
}
