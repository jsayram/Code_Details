import "@/styles/globals.css";
import { ThemeProvider } from "@/providers/theme-provider";
import { ToasterProvider } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SWRProvider } from "@/providers/swr-provider";
import { DocChaptersProvider } from "@/providers/doc-chapters-provider";
import { AuthBackendProvider } from "@/backend/auth/context";

export const metadata = {
  title: "Code Details",
  description: "Demo of code based web app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
      </head>
      <body className="overflow-x-hidden">
        {/* D08g4f2: no ClerkProvider (it went keyless and contacted Clerk
            without keys). Better Auth is the only login; with it off (backend
            "none"), its /api/auth answers 404, so the client sees nobody. */}
        <AuthBackendProvider backend="better-auth">
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <SWRProvider>
              <DocChaptersProvider>
                {/* Main content with centered container and responsive padding */}
                <ErrorBoundary>
                  <div className="max-w-[100vw] overflow-x-hidden">{children}</div>
                </ErrorBoundary>
                <ToasterProvider />
              </DocChaptersProvider>
            </SWRProvider>
          </ThemeProvider>
        </AuthBackendProvider>
      </body>
    </html>
  );
}
