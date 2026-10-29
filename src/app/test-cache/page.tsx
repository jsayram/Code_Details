import { unstable_cache } from "next/cache";
import { readAllActiveProjects } from "@/db/project-read";
import { getCachedDashboardStats } from "@/app/actions/dashboard";
import { getCachedAllTags } from "@/app/actions/tags";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cache Performance Test | Admin",
  description: "Test and verify cache performance for server actions",
};

// Force dynamic rendering to test server action caching (not page caching)
// This intentionally disables page cache to isolate action cache testing
export const dynamic = 'force-dynamic';

// Server-only now (D04a): it used to be a callable "use server" export.
const getCachedAllProjects = unstable_cache(async () => readAllActiveProjects(), ["all-projects"], {
  revalidate: 300, // 5 minutes
  tags: ["projects"],
});

export default async function CacheTestPage() {
  // Fetch data without timing on server (timing happens client-side)
  console.log('🧪 [TEST] Starting cache test...');
  
  const projects = await getCachedAllProjects();
  console.log(`📦 [TEST] Projects fetched: ${projects.length} items`);
  
  const stats = await getCachedDashboardStats();
  console.log(`📊 [TEST] Stats fetched`);
  
  const tags = await getCachedAllTags();
  console.log(`🏷️  [TEST] Tags fetched: ${tags.length} items`);
  
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Cache Performance Test</h1>
      
      <div className="space-y-4">
        <div className="p-4 border rounded-lg bg-blue-50/50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800">
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            ℹ️ About This Page
          </h2>
          <p className="text-sm mb-2">
            This page tests <strong>server action caching</strong>, not page caching. The page uses <code className="bg-muted px-1 rounded">force-dynamic</code> to disable page cache and isolate action cache testing.
          </p>
          <p className="text-xs text-muted-foreground">
            Note: DevTools warnings about &quot;cache-control: no-store&quot; and WebSockets are expected in development mode and don&apos;t affect cache testing.
          </p>
        </div>

        <div className="p-4 border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Test Instructions</h2>
          <ol className="list-decimal list-inside space-y-2">
            <li>Load this page and check the terminal logs</li>
            <li>Refresh the page immediately</li>
            <li>Compare response times in terminal - second load should be much faster</li>
            <li>Wait {'>'}5 minutes and refresh again to test cache expiration</li>
          </ol>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950">
            <h3 className="font-semibold">Projects</h3>
            <p className="text-2xl">{projects.length}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Items loaded
            </p>
            <p className="text-xs text-gray-500 mt-1">Cache: 5 minutes</p>
          </div>
          
          <div className="p-4 border rounded-lg bg-green-50 dark:bg-green-950">
            <h3 className="font-semibold">Dashboard Stats</h3>
            <p className="text-2xl">{stats.totalProjects}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Total projects
            </p>
            <p className="text-xs text-gray-500 mt-1">Cache: 3 minutes</p>
          </div>
          
          <div className="p-4 border rounded-lg bg-purple-50 dark:bg-purple-950">
            <h3 className="font-semibold">Tags</h3>
            <p className="text-2xl">{tags.length}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Total tags
            </p>
            <p className="text-xs text-gray-500 mt-1">Cache: 10 minutes</p>
          </div>
        </div>
        
        <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-950">
          <h3 className="font-semibold">Performance Testing</h3>
          <p className="text-sm mt-2">
            ✅ <strong>First load (no cache):</strong> Check terminal for fetch times (100-500ms)
          </p>
          <p className="text-sm mt-1">
            🚀 <strong>Cached load:</strong> Refresh and check terminal - times should drop to {'<'}10ms (10x faster!)
          </p>
        </div>
        
        <div className="p-4 border rounded-lg">
          <h3 className="font-semibold mb-2">Expected Results</h3>
          <ul className="space-y-1 text-sm">
            <li>✅ <strong>First load:</strong> Check terminal for database fetch logs</li>
            <li>✅ <strong>Immediate refresh:</strong> Much faster, no new logs (cache hit)</li>
            <li>✅ <strong>After cache time:</strong> Slower again, new logs (cache expired)</li>
          </ul>
        </div>
      </div>
      
      <div className="mt-8 p-4 border rounded-lg bg-gray-50 dark:bg-gray-900">
        <h3 className="font-semibold mb-2">Check Your Terminal</h3>
        <p className="text-sm mb-2">You should see logs like:</p>
        <pre className="bg-black text-green-400 p-2 rounded text-xs overflow-x-auto">
{`🧪 [TEST] Starting cache test...
📦 [TEST] Projects fetched: ${projects.length} items
📊 [TEST] Stats fetched
🏷️  [TEST] Tags fetched: ${tags.length} items`}
        </pre>
        <p className="text-sm mt-2">
          On refresh (cache hit), the page should load instantly from cache!
        </p>
      </div>
    </div>
  );
}
