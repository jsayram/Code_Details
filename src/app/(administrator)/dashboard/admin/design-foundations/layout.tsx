import "@/styles/foundations.css";

// The foundations stylesheet loads here and nowhere else until a screen adopts it.
export default function DesignFoundationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
