"use client";

// The app's own sign-in, sign-up, reset and error screens (D08f3b), shown
// instead of Clerk's only while the development Better Auth switch is on.
// They talk to Better Auth on the app origin (/api/auth/*). Messages never
// say whether an email has an account: sign-up, "send a new link" and the
// reset request answer the same way either way.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { refreshSession } from "@/lib/auth-session";
import { AuthCard, FormMessage, LINK, PRIMARY_BUTTON } from "./AuthCard";
import { RESET_PATH, VERIFIED_CALLBACK, authPost, sendVerificationLink } from "./api";
import { AUTH_ERROR_TEXT, authErrorKind, safeRedirect } from "./authErrors";

type Message = { tone: "error" | "info" | "success"; text: string } | null;

const TOO_MANY = "Too many attempts. Wait a minute and try again.";
const UNREACHABLE = "We couldn't reach the server. Check your connection and try again.";
const MIN_PASSWORD = 8;

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-foreground">
        {label}
      </Label>
      <Input id={id} required className="bg-background border-border focus:border-primary text-foreground placeholder:text-muted-foreground" {...props} />
    </div>
  );
}

function Form({ onSubmit, children }: { onSubmit: () => Promise<void>; children: ReactNode }) {
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await onSubmit();
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-5" aria-busy={pending}>
      <fieldset disabled={pending} className="grid gap-5">
        {children}
      </fieldset>
    </form>
  );
}

/** "Send a new link" for an address the user typed; the same answer whether or not it has an account. */
function NewLinkForm({ kind, initialEmail = "" }: { kind: "verify" | "reset"; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState<Message>(null);
  return (
    <>
      <Form
        onSubmit={async () => {
          const res = kind === "verify" ? await sendVerificationLink(email) : await authPost("/request-password-reset", { email, redirectTo: RESET_PATH });
          if (res.status === 429) return setMessage({ tone: "error", text: TOO_MANY });
          if (res.status === 0) return setMessage({ tone: "error", text: UNREACHABLE });
          setMessage({ tone: "success", text: "If that email needs a link, we've sent a new one. It works once, for an hour." });
        }}
      >
        <Field label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" className={PRIMARY_BUTTON}>
          Send a new link
        </Button>
      </Form>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
    </>
  );
}

const BackToSignIn = () => (
  <>
    <Link href="/sign-in" className={LINK}>
      Back to sign in
    </Link>
  </>
);

export function AuthErrorScreen({ code, resend = "verify" }: { code: string | null; resend?: "verify" | "reset" }) {
  const kind = authErrorKind(code);
  const text = AUTH_ERROR_TEXT[kind];
  return (
    <AuthCard title={text.title} subtitle={text.body} footer={<BackToSignIn />}>
      {kind === "link" ? (
        <NewLinkForm kind={resend} />
      ) : (
        <Button asChild className={PRIMARY_BUTTON}>
          <Link href="/sign-in">{kind === "account_not_linked" ? "Sign in with your password" : "Try again"}</Link>
        </Button>
      )}
    </AuthCard>
  );
}

function SignInScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<Message>(params.get("verified") === "1" ? { tone: "success", text: "Email confirmed. Sign in to continue." } : null);
  const [unverified, setUnverified] = useState(false);

  // A failed verify-email link comes back to its callback (/sign-in?verified=1) with ?error=.
  if (params.get("error")) return <AuthErrorScreen code={params.get("error")} />;

  return (
    <AuthCard
      image="/images/mascot.png"
      title="Sign in to Code Details"
      subtitle="Welcome back! Please sign in to continue"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className={LINK}>
            Sign up
          </Link>
        </>
      }
    >
      <Form
        onSubmit={async () => {
          setUnverified(false);
          const res = await authPost("/sign-in/email", { email, password });
          if (res.status === 200) {
            await refreshSession();
            router.push(safeRedirect(params.get("redirect_url")));
            router.refresh();
            return;
          }
          if (res.status === 403) {
            setUnverified(true);
            return setMessage({ tone: "error", text: "Confirm your email first. Open the link we sent you, or send a new one below." });
          }
          if (res.status === 401) return setMessage({ tone: "error", text: "Email or password is incorrect." });
          if (res.status === 429) return setMessage({ tone: "error", text: TOO_MANY });
          setMessage({ tone: "error", text: res.status === 0 ? UNREACHABLE : "We couldn't sign you in. Please try again." });
        }}
      >
        <Field label="Email address" type="email" autoComplete="email" placeholder="Enter your email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="grid gap-2">
          <Field label="Password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Link href={RESET_PATH} className={`${LINK} justify-self-end text-xs`}>
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className={PRIMARY_BUTTON}>
          Continue
        </Button>
      </Form>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
      {unverified ? (
        <div className="mt-6">
          <NewLinkForm kind="verify" initialEmail={email} />
        </div>
      ) : null}
    </AuthCard>
  );
}

export function SignUpScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) {
    return (
      <AuthCard title="Check your inbox" subtitle={<>We sent a link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to confirm your email, then sign in.</>} footer={<BackToSignIn />}>
        <p className="mb-4 text-sm text-muted-foreground">Didn&apos;t get it? Check spam, or send a new link.</p>
        <NewLinkForm kind="verify" initialEmail={sentTo} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Welcome! Please fill in the details to get started."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className={LINK}>
            Sign in
          </Link>
        </>
      }
    >
      <Form
        onSubmit={async () => {
          if (password.length < MIN_PASSWORD) return setMessage({ tone: "error", text: `Use at least ${MIN_PASSWORD} characters for your password.` });
          const res = await authPost("/sign-up/email", { name, email, password, callbackURL: VERIFIED_CALLBACK });
          // Better Auth answers 200 for an address that already has an account too.
          if (res.status === 200) return setSentTo(email);
          if (res.status === 429) return setMessage({ tone: "error", text: TOO_MANY });
          if (res.code === "PASSWORD_TOO_SHORT") return setMessage({ tone: "error", text: `Use at least ${MIN_PASSWORD} characters for your password.` });
          if (res.code === "PASSWORD_TOO_LONG") return setMessage({ tone: "error", text: "That password is too long." });
          if (res.code === "INVALID_EMAIL") return setMessage({ tone: "error", text: "Enter a valid email address." });
          setMessage({ tone: "error", text: res.status === 0 ? UNREACHABLE : "We couldn't create your account. Please try again." });
        }}
      >
        <Field label="Name" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email address" type="email" autoComplete="email" placeholder="Enter your email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" className={PRIMARY_BUTTON}>
          Continue
        </Button>
      </Form>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
    </AuthCard>
  );
}

function ResetScreen() {
  const params = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [done, setDone] = useState(false);
  const [badToken, setBadToken] = useState(false);

  if (params.get("error") || badToken) return <AuthErrorScreen code={params.get("error") ?? "invalid_token"} resend="reset" />;

  if (!token) {
    return (
      <AuthCard title="Reset your password" subtitle="Enter your email and we'll send you a link to choose a new password." footer={<BackToSignIn />}>
        <NewLinkForm kind="reset" />
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password changed" subtitle="Your new password is set. Sign in with it to continue.">
        <Button asChild className={PRIMARY_BUTTON}>
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" footer={<BackToSignIn />}>
      <Form
        onSubmit={async () => {
          if (password.length < MIN_PASSWORD) return setMessage({ tone: "error", text: `Use at least ${MIN_PASSWORD} characters for your password.` });
          if (password !== confirm) return setMessage({ tone: "error", text: "The passwords don't match." });
          const res = await authPost("/reset-password", { newPassword: password, token });
          if (res.status === 200) return setDone(true);
          if (res.code === "INVALID_TOKEN") return setBadToken(true);
          if (res.status === 429) return setMessage({ tone: "error", text: TOO_MANY });
          setMessage({ tone: "error", text: res.status === 0 ? UNREACHABLE : "We couldn't change your password. Please try again." });
        }}
      >
        <Field label="New password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" className={PRIMARY_BUTTON}>
          Change password
        </Button>
      </Form>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
    </AuthCard>
  );
}

function ErrorRoute() {
  return <AuthErrorScreen code={useSearchParams().get("error")} />;
}

/** /sign-in/* under the switch: the screen comes from the path. */
export function BetterAuthSignIn() {
  const path = usePathname() ?? "/sign-in";
  const screen = path.startsWith("/sign-in/reset-password") ? <ResetScreen /> : path.startsWith("/sign-in/error") ? <ErrorRoute /> : <SignInScreen />;
  return <Suspense fallback={null}>{screen}</Suspense>;
}
