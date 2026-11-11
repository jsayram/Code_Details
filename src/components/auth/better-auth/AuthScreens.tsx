"use client";

// The app's own sign-in, sign-up, reset and error screens (D08f3b), shown
// instead of Clerk's only while the development Better Auth switch is on.
// They talk to Better Auth on the app origin (/api/auth/*). Messages never
// say whether an email has an account: sign-up, "send a new link" and the
// reset request answer the same way either way.
import { Github } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useHydrated } from "@/components/auth/AuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { refreshSession } from "@/lib/auth-session";
import { AuthCard, FormMessage, LINK, PRIMARY_BUTTON } from "./AuthCard";
import { RESET_PATH, VERIFIED_CALLBACK, authPost, sendVerificationLink, startGitHub } from "./api";
import { AUTH_ERROR_TEXT, authErrorKind, safeRedirect } from "./authErrors";

// UI09.1: an error can name the fields it's about; they get aria-invalid, point
// at the message, and the first one takes focus.
type Message = { tone: "error" | "info" | "success"; text: string; fields?: string[] } | null;

const TOO_MANY = "Too many attempts. Wait a minute and try again.";
const UNREACHABLE = "We couldn't reach the server. Check your connection and try again.";
const MIN_PASSWORD = 8;

function Field({ label, invalid, describedBy, onInput, ...props }: { label: string; invalid?: boolean; describedBy?: string } & React.ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <div className="cd-field">
      <Label htmlFor={id} className="cd-field-label">
        {label}
      </Label>
      <Input
        id={id}
        required
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedBy : undefined}
        onInput={onInput}
        {...props}
      />
    </div>
  );
}

/** Which fields an error message is about, and a way to clear the mark once the person types again. */
function useFieldErrors(message: Message, messageId: string) {
  // Typing in a field clears its mark until the next message.
  const [cleared, setCleared] = useState<{ message: Message; names: string[] }>({ message: null, names: [] });
  const fields = message?.tone === "error" ? (message.fields ?? []) : [];
  const names = cleared.message === message ? cleared.names : [];
  return (name: string) => ({
    name,
    invalid: fields.includes(name) && !names.includes(name),
    describedBy: messageId,
    onInput: () => {
      if (fields.includes(name) && !names.includes(name)) setCleared({ message, names: [...names, name] });
    },
  });
}

// f7 (D08g3a): the fields are uncontrolled, so whatever the browser already
// holds when React hydrates (typed early, or autofilled) stays; values are read
// from the form on submit. The submit button stays disabled until hydration,
// so a form can't be sent natively (with a password) before its handler exists.
function Form({ onSubmit, children }: { onSubmit: (data: FormData) => Promise<void>; children: ReactNode }) {
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const settled = useRef(false);
  // UI09.1: the disabled fieldset drops focus to <body> while a request runs.
  // When it ends, focus goes to the first field marked invalid, or back to
  // the submit button, so keyboard and screen reader users stay in the form.
  useEffect(() => {
    if (pending || !settled.current) return;
    settled.current = false;
    const form = ref.current;
    if (!form) return;
    const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) return invalid.focus();
    if (!form.contains(document.activeElement) || document.activeElement === document.body) form.querySelector<HTMLElement>('button[type="submit"]')?.focus();
  }, [pending]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget); // before the fieldset disables the fields
    setPending(true);
    try {
      await onSubmit(data);
    } finally {
      settled.current = true;
      setPending(false);
    }
  };
  return (
    <form ref={ref} method="post" onSubmit={submit} className="cd-stack-tight" aria-busy={pending}>
      <fieldset disabled={pending} className="cd-auth-fields">
        {children}
      </fieldset>
    </form>
  );
}

function SubmitButton({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    <Button type="submit" disabled={!hydrated} className={PRIMARY_BUTTON}>
      {children}
    </Button>
  );
}

const text = (data: FormData, name: string) => String(data.get(name) ?? "");

/** "Send a new link" for an address the user typed; the same answer whether or not it has an account. */
function NewLinkForm({ kind, initialEmail = "" }: { kind: "verify" | "reset"; initialEmail?: string }) {
  const [message, setMessage] = useState<Message>(null);
  const messageId = useId();
  const field = useFieldErrors(message, messageId);
  return (
    <>
      <Form
        onSubmit={async (data) => {
          const email = text(data, "email");
          const res = kind === "verify" ? await sendVerificationLink(email) : await authPost("/request-password-reset", { email, redirectTo: RESET_PATH });
          if (res.status === 429) return setMessage({ tone: "error", text: TOO_MANY });
          if (res.status === 0) return setMessage({ tone: "error", text: UNREACHABLE });
          setMessage({ tone: "success", text: "If that email needs a link, we've sent a new one. It works once, for an hour." });
        }}
      >
        <Field label="Email address" type="email" autoComplete="email" defaultValue={initialEmail} {...field("email")} />
        <SubmitButton>
          Send a new link
        </SubmitButton>
      </Form>
      {message ? <FormMessage id={messageId} tone={message.tone}>{message.text}</FormMessage> : null}
    </>
  );
}

/** D08f3c: "Continue with GitHub" and the "or" divider above the email form. */
function GitHubSignIn({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="cd-stack-tight">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        className="w-full cursor-pointer"
        onClick={async () => {
          setPending(true);
          setError(await startGitHub({ callbackURL }));
          setPending(false);
        }}
      >
        <Github aria-hidden="true" />
        Continue with GitHub
      </Button>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <div className="cd-auth-divider cd-small cd-muted" aria-hidden="true">
        or
      </div>
    </div>
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
  const [message, setMessage] = useState<Message>(params.get("verified") === "1" ? { tone: "success", text: "Email confirmed. Sign in to continue." } : null);
  const [unverified, setUnverified] = useState(false);
  const messageId = useId();
  const field = useFieldErrors(message, messageId);

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
      <GitHubSignIn callbackURL={safeRedirect(params.get("redirect_url"))} />
      <Form
        onSubmit={async (data) => {
          setUnverified(false);
          const email = text(data, "email");
          setEmail(email);
          const res = await authPost("/sign-in/email", { email, password: text(data, "password") });
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
          if (res.status === 401) return setMessage({ tone: "error", text: "Email or password is incorrect.", fields: ["email", "password"] });
          if (res.status === 429) return setMessage({ tone: "error", text: TOO_MANY });
          setMessage({ tone: "error", text: res.status === 0 ? UNREACHABLE : "We couldn't sign you in. Please try again." });
        }}
      >
        <Field label="Email address" type="email" autoComplete="email" placeholder="Enter your email address" {...field("email")} />
        <div className="cd-stack-tight">
          <Field label="Password" type="password" autoComplete="current-password" placeholder="Enter your password" {...field("password")} />
          <Link href={RESET_PATH} className={`${LINK} cd-small cd-auth-aside-link`}>
            Forgot password?
          </Link>
        </div>
        <SubmitButton>
          Continue
        </SubmitButton>
      </Form>
      {message ? <FormMessage id={messageId} tone={message.tone}>{message.text}</FormMessage> : null}
      {unverified ? (
        <div className="cd-auth-section">
          <NewLinkForm kind="verify" initialEmail={email} />
        </div>
      ) : null}
    </AuthCard>
  );
}

function SignUpScreen() {
  const params = useSearchParams();
  const [message, setMessage] = useState<Message>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const messageId = useId();
  const field = useFieldErrors(message, messageId);

  if (sentTo) {
    return (
      <AuthCard title="Check your inbox" subtitle={<>We sent a link to <strong className="cd-wrap">{sentTo}</strong>. Open it to confirm your email, then sign in.</>} footer={<BackToSignIn />}>
        <p className="cd-small cd-muted">Didn&apos;t get it? Check spam, or send a new link.</p>
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
      <GitHubSignIn callbackURL={safeRedirect(params.get("redirect_url"))} />
      <Form
        onSubmit={async (data) => {
          const [name, email, password] = [text(data, "name"), text(data, "email"), text(data, "password")];
          if (password.length < MIN_PASSWORD) return setMessage({ tone: "error", text: `Use at least ${MIN_PASSWORD} characters for your password.`, fields: ["password"] });
          const res = await authPost("/sign-up/email", { name, email, password, callbackURL: VERIFIED_CALLBACK });
          // Better Auth answers 200 for an address that already has an account too.
          // It stores the address lowercased, so show it that way (F01-8).
          if (res.status === 200) return setSentTo(email.toLowerCase());
          if (res.status === 429) return setMessage({ tone: "error", text: TOO_MANY });
          if (res.code === "PASSWORD_TOO_SHORT") return setMessage({ tone: "error", text: `Use at least ${MIN_PASSWORD} characters for your password.`, fields: ["password"] });
          if (res.code === "PASSWORD_TOO_LONG") return setMessage({ tone: "error", text: "That password is too long.", fields: ["password"] });
          if (res.code === "INVALID_EMAIL") return setMessage({ tone: "error", text: "Enter a valid email address.", fields: ["email"] });
          setMessage({ tone: "error", text: res.status === 0 ? UNREACHABLE : "We couldn't create your account. Please try again." });
        }}
      >
        <Field label="Name" autoComplete="name" placeholder="Your name" {...field("name")} />
        <Field label="Email address" type="email" autoComplete="email" placeholder="Enter your email address" {...field("email")} />
        <Field label="Password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={MIN_PASSWORD} {...field("password")} />
        <SubmitButton>
          Continue
        </SubmitButton>
      </Form>
      {message ? <FormMessage id={messageId} tone={message.tone}>{message.text}</FormMessage> : null}
    </AuthCard>
  );
}

function ResetScreen() {
  const params = useSearchParams();
  const token = params.get("token");
  const [message, setMessage] = useState<Message>(null);
  const [done, setDone] = useState(false);
  const [badToken, setBadToken] = useState(false);
  const messageId = useId();
  const field = useFieldErrors(message, messageId);

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
        onSubmit={async (data) => {
          const [password, confirm] = [text(data, "password"), text(data, "confirm")];
          if (password.length < MIN_PASSWORD) return setMessage({ tone: "error", text: `Use at least ${MIN_PASSWORD} characters for your password.`, fields: ["password"] });
          if (password !== confirm) return setMessage({ tone: "error", text: "The passwords don't match.", fields: ["confirm"] });
          const res = await authPost("/reset-password", { newPassword: password, token });
          if (res.status === 200) return setDone(true);
          if (res.code === "INVALID_TOKEN") return setBadToken(true);
          if (res.status === 429) return setMessage({ tone: "error", text: TOO_MANY });
          setMessage({ tone: "error", text: res.status === 0 ? UNREACHABLE : "We couldn't change your password. Please try again." });
        }}
      >
        <Field label="New password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} {...field("password")} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} {...field("confirm")} />
        <SubmitButton>
          Change password
        </SubmitButton>
      </Form>
      {message ? <FormMessage id={messageId} tone={message.tone}>{message.text}</FormMessage> : null}
    </AuthCard>
  );
}

function ErrorRoute() {
  return <AuthErrorScreen code={useSearchParams().get("error")} />;
}

/** /sign-in/* under the switch: the screen comes from the path. */
export function BetterAuthSignIn() {
  const path = usePathname() ?? "/sign-in";
  const screen = path.startsWith("/sign-in/reset-password") ? (
    <ResetScreen />
  ) : path.startsWith("/sign-in/error") ? (
    <ErrorRoute />
  ) : (
    <SignInScreen />
  );
  return <Suspense fallback={null}>{screen}</Suspense>;
}

/** /sign-up under the switch. */
export function BetterAuthSignUp() {
  return (
    <Suspense fallback={null}>
      <SignUpScreen />
    </Suspense>
  );
}
