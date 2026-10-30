"use client";

import { UserPlus } from "lucide-react";
import { motion } from "framer-motion";
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

export function SignUpComponent({
  withIcon = true,
  withTitle = true,
  titleText = "",
  subTitleText = "",
}: SignUpComponentProps) {
  return (
    <>
      {(withIcon || withTitle) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8 w-full"
        >
          {withIcon && (
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
          )}
          {withTitle && (
            <>
              <h1 className="text-2xl font-semibold">{titleText}</h1>
              <p className="text-sm text-muted-foreground mt-2">
                {subTitleText}
              </p>
            </>
          )}
        </motion.div>
      )}
      {/* D08f3b: the app's own screen. D08g4f2: Clerk's is gone. */}
      <BetterAuthSignUp />
    </>
  );
}
