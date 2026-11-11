// H1 (moved from the app's h1-ssrf-routes test in X3): the server crawler
// refuses path parts that could walk the GitHub API before any request.
import { describe, expect, it } from "vitest";
import { serverGithubCrawler } from "../src/repoScrapper/server-crawler";

describe("serverGithubCrawler path parts", () => {
  it.each(["owner/repo#../../user", "owner/repo@a/../../b", "owner/repo#a//b", "owner/repo#a?b"])(
    "%s: refused before any request",
    async (repoUrl) => {
      await expect(serverGithubCrawler({ repoUrl } as never)).rejects.toMatchObject({ detail: expect.stringMatching(/Invalid GitHub URL/) });
    },
  );
});
