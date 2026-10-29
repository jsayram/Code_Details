// Server-component SignedIn/SignedOut (D08f2), for pages rendered on the
// server. They do exactly what Clerk's server versions did (read the
// request's session with auth() and render or not), so the server HTML is
// unchanged; there is no hydration step for them to race. Client components
// use ./AuthGate instead. D08f3 extends these to Better Auth behind the
// development switch.
import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";

export async function SignedIn({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  return userId ? <>{children}</> : null;
}

export async function SignedOut({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  return userId ? null : <>{children}</>;
}
