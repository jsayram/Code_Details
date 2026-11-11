"use client";

// The card the D08f3b screens share: picture, title and subtitle, the form,
// and a footer strip. UI09.1: on the design foundations. The card's title is
// the page's one h1, so each screen is named by what it does ("Reset your
// password"), and status lines use the foundations' status colors.
import Image from "next/image";
import { useId, type ReactNode } from "react";

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
  const titleId = useId();
  return (
    <section className="cd-surface cd-auth-card" aria-labelledby={titleId}>
      <div className="cd-auth-card-body">
        <Image src={image} alt="" width={96} height={96} className="cd-auth-card-image" priority />
        <h1 id={titleId} className="cd-heading cd-wrap text-center">
          {title}
        </h1>
        {subtitle ? <p className="cd-small cd-muted cd-wrap text-center">{subtitle}</p> : null}
        <div className="cd-auth-card-content">{children}</div>
      </div>
      {footer ? <div className="cd-auth-card-footer cd-small cd-muted">{footer}</div> : null}
    </section>
  );
}

/** A status line under a form; announced to screen readers. `id` lets fields point at it. */
export function FormMessage({ tone = "error", id, children }: { tone?: "error" | "info" | "success"; id?: string; children: ReactNode }) {
  return (
    <p id={id} role={tone === "error" ? "alert" : "status"} className="cd-form-message" data-tone={tone}>
      {children}
    </p>
  );
}

export const PRIMARY_BUTTON = "w-full cursor-pointer";
export const LINK = "cd-link font-medium";
