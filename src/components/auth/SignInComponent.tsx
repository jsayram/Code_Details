"use client";

import { Lock } from "lucide-react";
import { AuthGreeting } from "./AuthPageFrame";
import { BetterAuthSignIn } from "./better-auth/AuthScreens";

interface SignInComponentProps {
  withIcon?: boolean;
  withTitle?: boolean;
  titleText?: string;
  subTitleText?: string;
}

// UI09.1: the page's words sit above the card as a greeting; the card's title
// is the h1, so reset and error screens are named for what they do.
export function SignInComponent({ withIcon = true, withTitle = true, titleText = "", subTitleText = "" }: SignInComponentProps) {
  return (
    <>
      {withIcon && (
        <span className="cd-auth-icon" aria-hidden="true">
          <Lock className="h-6 w-6" />
        </span>
      )}
      {withTitle && <AuthGreeting title={titleText} subtitle={subTitleText} />}
      {/* D08f3b: the app's own screen. D08g4f2: Clerk's is gone. */}
      <BetterAuthSignIn />
    </>
  );
}
