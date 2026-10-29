"use client";

import { SignInButton } from "@clerk/nextjs";
import { Slot } from "@radix-ui/react-slot";
import { usePathname, useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useAuthBackend } from "@/backend/auth/context";
import { TextTypingEffectAnimation } from "@/animations/TextTypingEffectAnimation";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

// D08f3b: with the development Better Auth switch on, the same button goes
// to the app's /sign-in screen (and back here afterwards) instead of opening
// Clerk's modal. With Clerk it is Clerk's SignInButton with the same props.
function SignInTrigger({ children, ...props }: React.ComponentProps<typeof SignInButton> & { children: ReactElement }) {
  const backend = useAuthBackend();
  const router = useRouter();
  const pathname = usePathname();
  if (backend === "clerk") return <SignInButton {...props}>{children}</SignInButton>;
  const back = pathname && pathname !== "/" && !pathname.startsWith("/sign-") ? `?redirect_url=${encodeURIComponent(pathname)}` : "";
  return <Slot onClick={() => router.push(`/sign-in${back}`)}>{children}</Slot>;
}

interface SignInButtonProps {
  text?: string;
  animationSpeed?: number;
  useTypingEffect?: boolean;
  variant?: "terminal" | "plain";
}

export const SignInButtonComponent = ({
  text = "sudo --authenticate user",
  animationSpeed = 120,
  useTypingEffect = true,
  variant = "terminal",
}: SignInButtonProps) => {
  return (
    <SignInTrigger
      mode="modal"
      appearance={{
        elements: {
          card: "shadow-lg bg-card/95 border-1 border-primary mt-30 rounded-lg",
          headerTitle: "text-foreground",
          headerSubtitle: "text-muted-foreground",
          socialButtonsBlockButton:
            "bg-primary hover:bg-secondary/90 text-secondary-foreground",
          formButtonPrimary:
            "bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-none",
          formButtonReset: "text-muted-foreground hover:text-foreground",
          formFieldLabel: "text-foreground",
          formFieldInput:
            "bg-background border-border focus:border-primary text-foreground placeholder:text-muted-foreground",
          dividerLine: "bg-border",
          dividerText: "text-muted-foreground",
          logoBox: "flex items-center justify-center mb-4 mt-4",
          logoImage: "w-20 h-20 object-contain",
          organizationSwitcherTrigger:
            "bg-background border-border hover:bg-muted",
        },
        layout: {
          showOptionalFields: true,
          logoPlacement: "inside",
          logoImageUrl: "/images/CodeDetails_IconLogo.png",
        },
      }}
    >
      {variant === "terminal" ? (
        // Terminal Style
        <div className="flex items-center space-x-2">
          <span className="text-green-400">$</span>
          <div className="flex items-center text-xl relative bg-clip-text text-transparent bg-gradient-to-r from-lime-500 to-green-500 hover:from-yellow-300 hover:to-orange-400 transition-all duration-300 cursor-pointer font-mono">
            {useTypingEffect ? (
              <TextTypingEffectAnimation
                className="text-xl"
                text={text}
                speed={animationSpeed}
              />
            ) : (
              <span>{text}</span>
            )}
          </div>
        </div>
      ) : (
        // Plain Style
        <Button
          size="sm"
          className={cn(
            "relative hover:scale-105 transition-transform cursor-pointer",
            useTypingEffect && "min-w-[100px]"
          )}
        >
          {useTypingEffect ? (
            <TextTypingEffectAnimation text={text} speed={animationSpeed} />
          ) : (
            text
          )}
        </Button>
      )}
    </SignInTrigger>
  );
};
