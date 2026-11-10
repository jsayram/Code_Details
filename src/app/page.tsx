"use client";
import React, { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { HeroSection } from "@/components/layout/HeroSection";
import { FooterSection } from "@/components/layout/FooterSection";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { useDisplayUser } from "@/components/auth/useDisplayUser";
import { SignedIn } from "@/components/auth/AuthGate";
import { CodeParticlesElement } from "@/components/Elements/CodeParticlesElement";
import { HeroLoadingState } from "@/components/LoadingState/HeroLoadingState";
import { SidebarLoadingState } from "@/components/LoadingState/SidebarLoadingState";

// UI10: the particles' pause choice survives a reload in this browser only.
const PAUSE_KEY = "cd-particles-paused";

export default function Home() {
  const { isLoaded } = useDisplayUser();
  const [particlesPaused, setParticlesPaused] = useState(false);
  useEffect(() => {
    try {
      setParticlesPaused(window.localStorage.getItem(PAUSE_KEY) === "1");
    } catch {
      // Storage blocked: start playing, as before.
    }
  }, []);
  const toggleParticles = () => {
    setParticlesPaused((was) => {
      try {
        window.localStorage.setItem(PAUSE_KEY, was ? "0" : "1");
      } catch {
        // Storage blocked: the choice lasts until the page closes.
      }
      return !was;
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground theme-gradient-bg">
      <div className="absolute inset-0 z-11 pointer-events-none">
        <CodeParticlesElement paused={particlesPaused} />
      </div>
      <SidebarProvider>
        <SignedIn>
          {!isLoaded ? <SidebarLoadingState /> : <AppSidebar />}
        </SignedIn>
        <SidebarInset>
          <HeaderSection
            showLogo={true}
            showDarkModeButton={true}
            showMobileMenu={false}
          />
          {!isLoaded ? (
            <HeroLoadingState showActions={true} showImage={true} />
          ) : (
            <HeroSection />
          )}
          {/* WCAG 2.2.2: moving decoration needs a way to stop it. Hidden
              under reduced motion, where the particles already stand still. */}
          <div className="cd-foundations relative z-20 flex justify-end px-4 pb-2 motion-reduce:hidden">
            <button
              type="button"
              className="cd-shell-pill-button"
              onClick={toggleParticles}
              data-testid="particles-toggle"
            >
              {particlesPaused ? (
                <Play aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Pause aria-hidden="true" className="h-4 w-4" />
              )}
              {particlesPaused ? "Play background animation" : "Pause background animation"}
            </button>
          </div>
          <FooterSection />
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
