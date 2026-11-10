import { ChevronRight, type LucideIcon } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useDocChapters } from "@/providers/doc-chapters-provider";
import { useViewerId } from "@/components/auth/AuthGate";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

/** UI05: the spinner a nav entry showed while its page loaded, now from the link's own status. */
export function NavPending({ className = "ml-auto" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <span className={className} aria-hidden="true">
      <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </span>
  ) : null;
}

export function NavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon: LucideIcon;
    isActive?: boolean;
    /** Hidden from signed-out visitors (F01-14). */
    signedInOnly?: boolean;
    items?: {
      title: string;
      url: string;
      /** F02: a personal list, hidden from signed-out visitors. */
      signedInOnly?: boolean;
    }[];
  }[];
}) {
  const pathname = usePathname();
  const { chapters, currentChapter, projectMeta, isDocPage } = useDocChapters();
  // F01-14, UI05: the group label and the signed-in-only entries
  // appear only once the session confirms a user. "Still loading" counts as
  // signed out, so the server HTML and the first render never show them.
  const signedOut = typeof useViewerId() !== "string";
  const visibleItems = signedOut
    ? items
        .filter((item) => !item.signedInOnly)
        .map((item) => ({ ...item, items: item.items?.filter((subItem) => !subItem.signedInOnly) }))
    : items;

  // UI01 decision 9: "Explore", "GitHub Scraper" and "Graveyard" are text
  // changes only; every URL is the same.
  // Build dynamic items for GitHub Scraper when on doc page
  const getItemsWithChapters = (item: typeof items[0]) => {
    if (item.url === "/github-scrapper" && isDocPage && chapters.length > 0 && projectMeta) {
      return [
        ...(item.items || []),
        // Separator-like entry
        { title: `── ${projectMeta.projectName ?? projectMeta.projectSlug} ──`, url: '#divider', isDivider: true },
        // Dynamic chapter items
        ...chapters.map((chapter) => ({
          title: chapter.order === -1 ? `📋 ${chapter.title}` : `${chapter.order}. ${chapter.title}`,
          url: chapter.filename === '-1_overview.md' 
            ? `/github-scrapper/docs/${projectMeta.projectSlug}`
            : `/github-scrapper/docs/${projectMeta.projectSlug}/${chapter.filename}`,
          isChapter: true,
          isCurrentChapter: chapter.filename === currentChapter,
        })),
      ];
    }
    return item.items;
  };

  return (
    <SidebarGroup>
      {!signedOut && <SidebarGroupLabel>Explore</SidebarGroupLabel>}
      <SidebarMenu>
        {visibleItems.map((item) => {
          const dynamicItems = getItemsWithChapters(item);
          const hasActiveChild = dynamicItems?.some((subItem) =>
            pathname.startsWith(subItem.url) && subItem.url !== '#divider'
          );
          // Also check if we're on a doc page for GitHub Scrapper
          const isOnDocPage = item.url === "/github-scrapper" && pathname.startsWith('/github-scrapper/docs');
          const isActive =
            pathname === item.url ||
            (hasActiveChild && pathname.startsWith(item.url)) ||
            isOnDocPage;

          return (
            <Collapsible key={item.title} asChild defaultOpen={hasActiveChild || isOnDocPage}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  isActive={isActive}
                  size="default"
                  className={cn(
                    "transition-colors relative group",
                    hasActiveChild || isOnDocPage
                      ? "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      : ""
                  )}
                >
                  <Link href={item.url} aria-current={pathname === item.url ? "page" : undefined}>
                    <item.icon className="size-5" aria-hidden="true" />
                    <span>{item.title}</span>
                    <NavPending />
                  </Link>
                </SidebarMenuButton>
                {dynamicItems?.length ? (
                  <>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction className="data-[state=open]:rotate-90 transition-transform duration-200 cursor-pointer size-6 after:-inset-3">
                        <ChevronRight className="size-5" />
                        <span className="sr-only">{`Show ${item.title} pages`}</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {dynamicItems?.map((subItem: any) => {
                          // Handle divider items
                          if (subItem.isDivider) {
                            return (
                              <SidebarMenuSubItem key={subItem.title}>
                                <div className="px-2 py-2 text-xs font-semibold text-muted-foreground truncate">
                                  {subItem.title}
                                </div>
                              </SidebarMenuSubItem>
                            );
                          }
                          
                          const isSubItemActive = subItem.isChapter 
                            ? subItem.isCurrentChapter
                            : pathname === subItem.url ||
                              (pathname.startsWith(subItem.url) &&
                                !dynamicItems?.some(
                                  (other: any) =>
                                    other !== subItem &&
                                    !other.isDivider &&
                                    pathname.startsWith(other.url)
                                ));
                          return (
                            <SidebarMenuSubItem key={subItem.title}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={isSubItemActive}
                                className={cn(
                                  "relative group",
                                  subItem.isChapter && "text-xs"
                                )}
                                size="md"
                              >
                                <Link href={subItem.url} aria-current={isSubItemActive ? "page" : undefined}>
                                  <span className="truncate">{subItem.title}</span>
                                  <NavPending />
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </>
                ) : null}
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
