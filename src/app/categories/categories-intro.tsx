import { PROJECT_CATEGORIES } from "@/constants/project-categories";

export const CATEGORY_COUNT = Object.keys(PROJECT_CATEGORIES).length;

// The page's title block, shared by the page and its loading screen so the
// two line up while the route loads.
export function CategoriesIntro() {
  return (
    <header className="cd-stack-tight">
      <h1 className="cd-title cd-wrap">Browse All Categories</h1>
      <p className="cd-lead cd-muted cd-reading">
        Explore projects organized by category, from web applications to AI/ML and beyond.
      </p>
      <p className="cd-small cd-muted">
        <span className="cd-number">{CATEGORY_COUNT}</span> categories
      </p>
    </header>
  );
}
