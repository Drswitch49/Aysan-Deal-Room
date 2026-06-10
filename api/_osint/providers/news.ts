/**
 * OSINT Provider: News Aggregation
 *
 * Fetches recent news mentions for a target company.
 * Uses NewsAPI.org (free tier: 100 req/day) or falls back to
 * DuckDuckGo News search (no API key required).
 *
 * Scope: recent news headlines, summaries, publication dates.
 * Not intended for deep content extraction.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NewsArticle {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  description: string;
}

export interface NewsResult {
  found: boolean;
  articles: NewsArticle[];
  error?: string;
}

// ─── NewsAPI Provider (requires API key) ────────────────────────────────────

async function fetchFromNewsAPI(companyName: string): Promise<NewsResult> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return { found: false, articles: [] };

  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]; // 30 days back

  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(
        `"${companyName}"`
      )}&from=${from}&sortBy=relevancy&language=en&pageSize=5&apiKey=${apiKey}`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!res.ok) return { found: false, articles: [] };

    const data = await res.json();
    const articles: NewsArticle[] = ((data.articles as any[]) || [])
      .slice(0, 5)
      .map((a) => ({
        title: a.title || "",
        source: a.source?.name || "Unknown",
        publishedAt: a.publishedAt || "",
        url: a.url || "",
        description: (a.description || "").substring(0, 400),
      }));

    return { found: articles.length > 0, articles };
  } catch (err: any) {
    return { found: false, articles: [], error: err.message };
  }
}

// ─── DuckDuckGo Fallback (no API key required) ───────────────────────────────

async function fetchFromDuckDuckGo(companyName: string): Promise<NewsResult> {
  try {
    const query = encodeURIComponent(`${companyName} news`);
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`,
      {
        headers: { "User-Agent": "Mozilla/5.0 compatible" },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) return { found: false, articles: [] };

    const data = await res.json();

    // DuckDuckGo Instant Answer API returns RelatedTopics
    const topics: any[] = data.RelatedTopics || [];
    const articles: NewsArticle[] = topics
      .filter((t) => t.FirstURL && t.Text)
      .slice(0, 5)
      .map((t) => ({
        title: (t.Text || "").substring(0, 120),
        source: "DuckDuckGo",
        publishedAt: new Date().toISOString(),
        url: t.FirstURL || "",
        description: (t.Text || "").substring(0, 400),
      }));

    return { found: articles.length > 0, articles };
  } catch (err: any) {
    return { found: false, articles: [], error: err.message };
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Fetches recent news for a company. Tries NewsAPI first (if key available),
 * falls back to DuckDuckGo.
 */
export async function fetchCompanyNews(companyName: string): Promise<NewsResult> {
  // Try NewsAPI first
  const newsApiResult = await fetchFromNewsAPI(companyName);
  if (newsApiResult.found) return newsApiResult;

  // Fall back to DuckDuckGo
  const ddgResult = await fetchFromDuckDuckGo(companyName);
  return ddgResult;
}
