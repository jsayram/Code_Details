"use client";

import { AuthPageFrame } from "@/components/auth/AuthPageFrame";
import { SignUpComponent } from "@/components/auth/SignUpComponent";

export default function SignUpPage() {
  return (
    <AuthPageFrame>
      <SignUpComponent withTitle={true} withIcon={false} titleText="Join Code Details" subTitleText="Create your account to get started with Code Details." />
    </AuthPageFrame>
  );
}
