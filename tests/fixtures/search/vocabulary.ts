// D09 S00.2: synthetic technology vocabulary for the search contract and the
// S01 benchmark. Hand-written, not taken from real data. It is a review
// fixture, not the production alias table: tagAliases stays empty until S03,
// where each alias is reviewed before it ships.
//
// `aliases` match both ways (a search for either finds the other).
// `narrower` is one-way: searching the canonical also finds these, never the
// reverse ("javascript" finds TypeScript projects; "typescript" doesn't find
// every JavaScript project). `noFuzz` marks identifiers too short or too
// punctuation-heavy to typo-correct safely: `c` must not become `go`, and
// `c#` must not become `c++`.

export interface VocabularyEntry {
  /** Canonical technology ID, stable, lowercase. */
  id: string;
  /** Display name. */
  label: string;
  /** Reviewed two-way equivalents, as a visitor might type them. */
  aliases: string[];
  /** One-way: the canonical's search also covers these IDs. */
  narrower?: string[];
  noFuzz?: boolean;
}

export const SEARCH_VOCABULARY: VocabularyEntry[] = [
  { id: "c", label: "C", aliases: [], noFuzz: true },
  { id: "cpp", label: "C++", aliases: ["c++", "cplusplus"], noFuzz: true },
  { id: "csharp", label: "C#", aliases: ["c#", "c sharp"], noFuzz: true },
  { id: "dotnet", label: ".NET", aliases: [".net", "dot net", "dotnet core"], noFuzz: true },
  { id: "go", label: "Go", aliases: ["golang"], noFuzz: true },
  { id: "r", label: "R", aliases: ["rlang"], noFuzz: true },
  { id: "javascript", label: "JavaScript", aliases: ["js", "ecmascript"], narrower: ["typescript"] },
  { id: "typescript", label: "TypeScript", aliases: ["ts"] },
  { id: "nodejs", label: "Node.js", aliases: ["node.js", "node", "nodejs"] },
  { id: "nextjs", label: "Next.js", aliases: ["next.js", "nextjs", "next js"] },
  { id: "react", label: "React", aliases: ["reactjs", "react.js"] },
  { id: "react-native", label: "React Native", aliases: ["react-native", "rn"] },
  { id: "postgresql", label: "PostgreSQL", aliases: ["postgres", "psql", "pg"] },
  { id: "kubernetes", label: "Kubernetes", aliases: ["k8s"] },
  { id: "swift", label: "Swift", aliases: ["swiftlang"] },
  { id: "swiftui", label: "SwiftUI", aliases: ["swift ui"] },
  { id: "python", label: "Python", aliases: ["py", "python3"] },
  { id: "tauri", label: "Tauri", aliases: [] },
  { id: "electron", label: "Electron", aliases: ["electronjs"] },
  { id: "docker", label: "Docker", aliases: [] },
  { id: "java", label: "Java", aliases: [] },
];

/**
 * Pairs that look alike but are different technologies. A match for one must
 * never be produced by typo correction or alias expansion of the other.
 */
export const NEVER_EQUIVALENT: [string, string][] = [
  ["c", "cpp"],
  ["c", "csharp"],
  ["cpp", "csharp"],
  ["javascript", "java"],
  ["react", "react-native"],
  ["swift", "swiftui"],
  ["go", "c"],
  ["r", "c"],
];
