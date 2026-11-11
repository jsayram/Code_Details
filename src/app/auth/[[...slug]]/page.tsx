"use client";
import { SignedIn, useViewerId } from "@/components/auth/AuthGate";
import { AccountSignOutButton } from "@/components/auth/AccountButton";
import { SignUpForm } from "@/components/auth/SignUpComponent";
import { AuthGreeting, AuthPageFrame } from "@/components/auth/AuthPageFrame";
import { AuthCard, LINK, PRIMARY_BUTTON } from "@/components/auth/better-auth/AuthCard";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { TerminalWindowSection } from "@/components/layout/TerminalWindowSection";

// UI09.1: /auth/sign-out (and the older /auth and /auth/sign-up) on the same
// frame and card as /sign-in. The redirects are unchanged: a signed-in visitor
// is sent home from anything but sign-out, and a signed-out visitor from
// sign-out to /auth, which the proxy sends to sign in.
export default function AuthPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const resolvedParams = React.use(params);
  const page = resolvedParams.slug?.[0];
  const viewerId = useViewerId();
  const isLoaded = viewerId !== undefined;
  const isSignedIn = !!viewerId;
  const router = useRouter();

  // Prevent endless loop by redirecting authenticated users
  useEffect(() => {
    if (isLoaded && isSignedIn && page !== "sign-out") {
      router.push("/");
    }

    // Redirect away from sign-out route if not signed in
    if (isLoaded && !isSignedIn && page === "sign-out") {
      router.push("/auth");
    }
  }, [isLoaded, isSignedIn, router, page]);

  // Don't render sign-in/sign-up if already logged in
  if (isLoaded && isSignedIn && page !== "sign-out") {
    return null; // Will redirect via useEffect
  }

  // Don't render sign-out if not logged in
  if (isLoaded && !isSignedIn && page === "sign-out") {
    return null; // Will redirect via useEffect
  }

  return <AuthPageFrame>{renderAuthComponent(page)}</AuthPageFrame>;
}

function renderAuthComponent(page?: string) {
  switch (page) {
    case "sign-up":
      return (
        <>
          <AuthGreeting title="Sign up for an account" subtitle="Create your account to get started" />
          <SignUpForm />
        </>
      );
    case "sign-out":
      return (
        <AuthCard
          title="Sign out of your account"
          subtitle="You can sign back in at any time."
          footer={
            <Link href="/" className={LINK}>
              Back to home
            </Link>
          }
        >
          <SignedIn>
            <AccountSignOutButton redirectUrl="/">
              <Button className={PRIMARY_BUTTON}>Sign out</Button>
            </AccountSignOutButton>
          </SignedIn>
        </AuthCard>
      );
    default:
      return (
        <div className="cd-stack cd-auth-terminal">
          <h1 className="cd-heading text-center">Sign in to see that page</h1>
          <TerminalWindowSection
            width="w-full min-h-[250px]"
            showTrafficLights={true}
            showDatetime={true}
            unauthenticatedMessage="Hey Code Minion, sign in to access that content!"
          />
          <Image className="mx-auto w-[220px] sm:w-[260px]" src="/images/mascot.png" alt="Code Details Mascot" width={1200} height={1200} sizes="260px" priority />
        </div>
      );
  }
}
