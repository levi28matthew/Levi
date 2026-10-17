import type { ReactNode } from "react";
import { MobileNav, SidebarNav } from "@/components/nav";
import { getSessionContext, isSupabaseConfigured } from "@/lib/queries";

/**
 * The signed-in application shell.
 *
 * The sidebar is only rendered for an authenticated session: a visitor who is signed
 * out gets the page's own "sign in to continue" panel rather than navigation that
 * would lead nowhere. `getSessionContext()` is cached per request by Next, so this
 * costs nothing extra when the page below resolves the same session.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = isSupabaseConfigured() ? await getSessionContext() : null;

  if (!session) {
    return (
      <div className="app">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <main id="main" className="shell" style={{ maxWidth: 760 }}>
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SidebarNav />
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <MobileNav />
        <main id="main" className="shell">
          {children}
        </main>
      </div>
    </div>
  );
}
