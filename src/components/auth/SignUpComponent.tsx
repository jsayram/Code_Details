"use client";

import { UserPlus } from "lucide-react";
import { AuthGreeting } from "./AuthPageFrame";
import { BetterAuthSignUp } from "./better-auth/AuthScreens";

interface SignUpComponentProps {
  withIcon?: boolean;
  withTitle?: boolean;
  titleText?: string;
  subTitleText?: string;
}

/** The bare form on /auth/sign-up: the app's screen. */
export function SignUpForm() {
  return <BetterAuthSignUp />;
}

// UI09.1: as SignInComponent, the greeting is words and the card's title is the h1.
export function SignUpComponent({ withIcon = true, withTitle = true, titleText = "", subTitleText = "" }: SignUpComponentProps) {
  return (
    <>
      {withIcon && (
        <span className="cd-auth-icon" aria-hidden="true">
          <UserPlus className="h-6 w-6" />
        </span>
      )}
      {withTitle && <AuthGreeting title={titleText} subtitle={subTitleText} />}
      {/* D08f3b: the app's own screen. D08g4f2: Clerk's is gone. */}
      <BetterAuthSignUp />
    </>
  );
}
