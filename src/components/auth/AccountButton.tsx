"use client";

// The header's account controls (D08f3a): an app menu built from the shadcn
// dropdown and avatar (the user's name and email, and "Sign out"), from the
// Better Auth session. D08g4f2: Clerk's UserButton and SignOutButton are gone;
// the headers still pass Clerk's `appearance` prop, of which only the avatar
// size class is used.
import { Slot } from "@radix-ui/react-slot";
import { Github } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
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
  /** Display name. */
  name: string | null;
  email: string | null;
}

export function useAccountSummary(): AccountSummary {
  const session = useBetterAuthSession(true);
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

/** Sign out, then go to afterSignOutUrl. */
export function useAccountSignOut(afterSignOutUrl = "/") {
  return useSignOutThen(afterSignOutUrl);
}

const initials = (name: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

type AccountButtonProps = { appearance?: { elements?: Record<string, unknown> }; afterSignOutUrl?: string };

export function AccountButton(props: AccountButtonProps) {
  // The same size class the header gave Clerk's avatar.
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

/** The child, wired to the Better Auth sign-out. */
export function AccountSignOutButton({ children, redirectUrl }: { children: ReactElement; redirectUrl?: string }) {
  const signOutThen = useSignOutThen(redirectUrl);
  return <Slot onClick={() => void signOutThen()}>{children}</Slot>;
}
