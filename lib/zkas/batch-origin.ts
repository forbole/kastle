const httpsOrigin = /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/;
const httpLoopbackOrigin =
  /^http:\/\/(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/;

export function assertBatchOrigin(value: string): void {
  if (typeof value === "string" && value.length <= 200) {
    if (httpsOrigin.test(value)) return;
    const loopback = httpLoopbackOrigin.exec(value);
    if (loopback) {
      const port = Number(loopback[1]);
      if (port <= 65535 && port !== 80) return;
    }
  }
  throw new Error("Invalid batch application origin");
}
