"use client";

import { AuthPageFrame } from "@/components/auth/AuthPageFrame";
import { SignInComponent } from "@/components/auth/SignInComponent";

export default function SignInPage() {
  return (
    <AuthPageFrame>
      <SignInComponent withTitle={true} withIcon={false} titleText="Hopefully you are not lost." subTitleText="Sign in to continue or create an account." />
    </AuthPageFrame>
  );
}
