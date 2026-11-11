// H1: lets a test reach a throwaway server it started on 127.0.0.1. The
// isolation guard in vitest-setup.ts still refuses every non-loopback host.
const ports = () =>
  ((globalThis as Record<symbol, unknown>)[Symbol.for("codedetails.testOwnedPorts")] ??= new Set<number>()) as Set<number>;

export function allowTestOwnedPort(port: number): () => void {
  ports().add(port);
  return () => void ports().delete(port);
}
