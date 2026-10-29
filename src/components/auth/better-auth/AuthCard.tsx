"use client";

// The card the D08f3b screens share, modelled on Clerk's card as the app
// styled it (SignInComponent's appearance and the Phase A a08 screenshots):
// picture, title and subtitle, the form, and a muted footer strip.
import Image from "next/image";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function AuthCard({
  image = "/images/CodeDetails_IconLogo.png",
  title,
  subtitle,
  children,
  footer,
}: {
  image?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="w-full max-w-[25rem] mx-auto gap-0 overflow-hidden rounded-xl border-0 bg-card p-0 shadow-lg backdrop-blur-sm">
      <div className="px-10 pt-2 pb-8">
        <div className="flex items-center justify-center mb-4 mt-4">
          <Image src={image} alt="" width={116} height={116} className="w-29 h-29 object-contain" priority />
        </div>
        <h2 className="text-center text-lg font-bold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 text-center text-sm text-muted-foreground">{subtitle}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
      {footer ? <div className="border-t border-border/50 bg-muted/40 px-10 py-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}

/** A status line under a form; announced to screen readers. */
export function FormMessage({ tone = "error", children }: { tone?: "error" | "info" | "success"; children: ReactNode }) {
  const color = tone === "error" ? "text-destructive" : tone === "success" ? "text-green-500" : "text-muted-foreground";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mt-4 text-sm ${color}`}>
      {children}
    </p>
  );
}

export const PRIMARY_BUTTON = "w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-none cursor-pointer";
export const LINK = "text-primary hover:text-primary/90 font-medium underline-offset-4 hover:underline";
