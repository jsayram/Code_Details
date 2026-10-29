"use client";

// The header's account controls (D08f3a). With Clerk (the default) these are
// exactly Clerk's UserButton, SignOutButton and useUser with the props the
// headers already pass, so nothing changes on screen. With the development
// Better Auth switch on, they are an app menu built from the shadcn dropdown
// and avatar: the user's name and email, and "Sign out".
import { SignOutButton, UserButton, useUser } from "@clerk/nextjs";
import { Slot } from "@radix-ui/react-slot";
import { Github } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ComponentProps, type ReactElement } from "react";
import { useAuthBackend } from "@/backend/auth/context";
import { signOut, useBetterAuthSession } from "@/lib/auth-session";
import { startGitHub } from "@/components/auth/better-auth/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface AccountSummary {
  isLoaded: boolean;
  hasUser: boolean;
  /** Display name, falling back to the handle (Clerk: fullName || username). */
  name: string | null;
  email: string | null;
}

export function useAccountSummary(): AccountSummary {
  const backend = useAuthBackend();
  const { user, isLoaded } = useUser();
  const session = useBetterAuthSession(backend === "better-auth");
  if (backend === "clerk") {
    return {
      isLoaded,
      hasUser: !!user,
      name: user ? user.fullName || user.username : null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
    };
  }
  if (session.status === "loading") return { isLoaded: false, hasUser: false, name: null, email: null };
  return { isLoaded: true, hasUser: !!session.user, name: session.user?.name ?? null, email: session.user?.email ?? null };
}

function useSignOutThen(afterSignOutUrl = "/") {
  const router = useRouter();
  return async () => {
    await signOut();
    router.push(afterSignOutUrl);
    router.refresh();
  };
}

const initials = (name: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

type UserButtonProps = ComponentProps<typeof UserButton>;

export function AccountButton(props: UserButtonProps) {
  const backend = useAuthBackend();
  if (backend === "clerk") return <UserButton {...props} />;
  // The same size class the header gives Clerk's avatar.
  const elements = props.appearance?.elements as Record<string, unknown> | undefined;
  const avatarClassName = typeof elements?.userButtonAvatarBox === "string" ? elements.userButtonAvatarBox : undefined;
  return <AppAccountMenu avatarClassName={avatarClassName} afterSignOutUrl={props.afterSignOutUrl} />;
}

function AppAccountMenu({ avatarClassName, afterSignOutUrl }: { avatarClassName?: string; afterSignOutUrl?: string }) {
  const session = useBetterAuthSession(true);
  const { name, email } = useAccountSummary();
  const signOutThen = useSignOutThen(afterSignOutUrl);
  const user = session.status === "ready" ? session.user : null;
  const pathname = usePathname();
  // D08f3c: whether GitHub is connected, checked each time the menu opens.
  const [github, setGitHub] = useState<"unknown" | "connected" | "not" | { error: string }>("unknown");
  const checkGitHub = async () => {
    try {
      const res = await fetch("/api/auth/list-accounts", { credentials: "same-origin", cache: "no-store" });
      const accounts = res.ok ? ((await res.json()) as { providerId: string }[]) : null;
      setGitHub(accounts ? (accounts.some((a) => a.providerId === "github") ? "connected" : "not") : "unknown");
    } catch {
      setGitHub("unknown");
    }
  };
  return (
    <DropdownMenu onOpenChange={(open) => void (open && checkGitHub())}>
      <DropdownMenuTrigger className="rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Open account menu">
        <Avatar className={avatarClassName ?? "h-8 w-8"}>
          {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="grid text-sm leading-tight">
          <span className="truncate font-medium">{name}</span>
          {email ? <span className="truncate text-xs font-normal text-muted-foreground">{email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {github === "connected" ? (
          <DropdownMenuItem disabled>
            <Github aria-hidden="true" />
            GitHub connected
          </DropdownMenuItem>
        ) : github === "not" ? (
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={async (e) => {
              e.preventDefault();
              const error = await startGitHub({ link: true, callbackURL: pathname ?? "/" });
              if (error) setGitHub({ error });
            }}
          >
            <Github aria-hidden="true" />
            Connect GitHub
          </DropdownMenuItem>
        ) : typeof github === "object" ? (
          <DropdownMenuItem disabled role="alert">
            {github.error}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="cursor-pointer" onSelect={() => void signOutThen()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Clerk's SignOutButton, or the same child wired to the Better Auth sign-out. */
export function AccountSignOutButton({ children, redirectUrl }: { children: ReactElement; redirectUrl?: string }) {
  const backend = useAuthBackend();
  const signOutThen = useSignOutThen(redirectUrl);
  if (backend === "clerk") return <SignOutButton redirectUrl={redirectUrl}>{children}</SignOutButton>;
  return <Slot onClick={() => void signOutThen()}>{children}</Slot>;
}
