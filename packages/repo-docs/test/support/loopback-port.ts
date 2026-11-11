// Lets a test reach a throwaway server it started on 127.0.0.1. The socket
// guard (this package's test/support/setup.ts, or the app's vitest-setup.ts when
// the root suite runs these files) still refuses every other host and port.
// The key is shared with the app's guard so both runs honor it.
const ports = () =>
  ((globalThis as Record<symbol, unknown>)[Symbol.for("codedetails.testOwnedPorts")] ??= new Set<number>()) as Set<number>;

export function allowTestOwnedPort(port: number): () => void {
  ports().add(port);
  return () => void ports().delete(port);
}
