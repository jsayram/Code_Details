import "@/styles/globals.css";
import type { Viewport } from "next";
import { ThemeProvider } from "@/providers/theme-provider";
import { ToasterProvider } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SWRProvider } from "@/providers/swr-provider";
import { DocChaptersProvider } from "@/providers/doc-chapters-provider";
import { MotionProvider } from "@/providers/motion-provider";

export const metadata = {
  title: "Code Details",
  description: "Demo of code based web app",
};

// UI03 (decision 10): no maximum-scale or user-scalable, so people can pinch to zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="overflow-x-hidden">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <MotionProvider>
            <SWRProvider>
              <DocChaptersProvider>
                {/* Main content with centered container and responsive padding */}
                <ErrorBoundary>
                  <div className="max-w-[100vw] overflow-x-hidden">{children}</div>
                </ErrorBoundary>
                <ToasterProvider />
              </DocChaptersProvider>
            </SWRProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
