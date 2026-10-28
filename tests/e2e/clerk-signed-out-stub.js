// Served by the browser tests in place of Clerk's hosted clerk-js script, which
// they must not download. It stands in for a signed-out visitor only: no
// session, no user, and every Clerk UI method is a no-op. Signed-in flows are
// out of scope for these tests; D01/D08 replace Clerk anyway.
(function () {
  const listeners = new Set();
  const client = { sessions: [], signedInSessions: [], activeSessions: [], lastActiveSessionId: null };
  const state = () => ({ client, session: null, user: null, organization: null });
  const base = {
    loaded: false,
    status: "ready",
    version: "signed-out-test-stub",
    sdkMetadata: { name: "codedetails-test-stub", version: "0" },
    client,
    session: null,
    user: null,
    organization: null,
    isSignedIn: false,
    async load() {
      this.loaded = true;
      listeners.forEach((cb) => cb(state()));
    },
    addListener(cb) {
      listeners.add(cb);
      if (this.loaded) cb(state());
      return () => listeners.delete(cb);
    },
    on() {},
    off() {},
    async signOut() {},
    buildSignInUrl: () => "/sign-in",
    buildSignUpUrl: () => "/sign-up",
    buildUrlWithAuth: (to) => to,
    telemetry: { isEnabled: false, isDebug: false, record() {}, recordLog() {} },
  };
  // A callable no-op whose every property is another no-op, so nested calls
  // such as clerk.something.method() also do nothing.
  const noop = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" || typeof prop === "symbol" ? undefined : noop),
    apply: () => undefined,
  });
  // Anything else Clerk's React layer touches (mountSignIn, openSignIn, ...) is a no-op.
  window.Clerk = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return noop;
    },
  });
})();
