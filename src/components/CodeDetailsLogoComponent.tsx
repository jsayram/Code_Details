"use client";

import React from "react";
import Link, { useLinkStatus } from "next/link";
import Image from "next/image";

interface LogoProps {
  showText?: boolean;
  showLogo?: boolean;
  showTagline?: boolean;
  size?: "sm" | "md" | "lg";
  taglineSize?: "2xs" | "xs" | "sm" | "md" | "lg";
  href?: string;
  className?: string;
  tagLineText?: string;
  mainLogoText?: string;
}

const sizeMap = {
  sm: { logo: "h-6 w-6", text: "text-lg" },
  md: { logo: "h-8 w-8", text: "text-xl" },
  lg: { logo: "h-10 w-10", text: "text-2xl md:text-3xl" },
};

const taglineSizeMap = {
  "2xs": "text-[10px]",
  xs: "text-xs",
  sm: "text-sm",
  md: "text-default",
  lg: "text-lg",
};

/** Shown while the logo's link is navigating, as before. */
function Pending() {
  const { pending } = useLinkStatus();
  return (
    <span className="ml-1 flex h-4 w-4 items-center justify-center" aria-hidden="true">
      {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
    </span>
  );
}

// UI05 (UI01 decisions 6 and 10): one logo, the {d} icon with "Code Details"
// in solid text, and a real link so the keyboard reaches it. The gradient
// "code.{ d }" wordmark and the gradient halo behind the icon are retired.
export function Logo({
  showText = true,
  showTagline = true,
  showLogo = true,
  size = "sm",
  taglineSize = "2xs",
  href = "/",
  className = "",
  tagLineText = "Learn, Build, Repeat",
  mainLogoText = "Code Details",
}: LogoProps) {
  const content = (
    <>
      {showLogo && (
        <Image
          src="/images/CodeDetails_IconLogo.png"
          alt=""
          width={40}
          height={40}
          priority={true}
          className={`shrink-0 ${sizeMap[size].logo}`}
        />
      )}
      {showText && (
        <span className="flex flex-col">
          <span className={`font-semibold leading-none tracking-tight ${sizeMap[size].text}`}>{mainLogoText}</span>
          {showTagline && <span className={`hidden opacity-80 sm:block ${taglineSizeMap[taglineSize]}`}>{tagLineText}</span>}
        </span>
      )}
    </>
  );
  const classes = `cd-shell-logo inline-flex items-center gap-2 ${className}`;

  return href ? (
    <Link href={href} className={classes} aria-label={showText ? undefined : mainLogoText}>
      {content}
      <Pending />
    </Link>
  ) : (
    <span className={classes}>{content}</span>
  );
}
