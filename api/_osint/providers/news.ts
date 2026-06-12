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

// ─── Google News RSS Parser (no API key required) ───────────────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

async function fetchFromGoogleNewsRSS(companyName: string): Promise<NewsResult> {
  try {
    const query = encodeURIComponent(`"${companyName}"`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    
    const res = await fetch(url, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return { found: false, articles: [] };

    const xmlText = await res.text();
    const articles: NewsArticle[] = [];
    
    // Match all <item>...</item> blocks
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(xmlText)) !== null && articles.length < 5) {
      const itemContent = match[1];
      
      // Extract title
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
      const fullTitle = titleMatch ? titleMatch[1] : "Untitled Article";
      
      // Extract link
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
      const linkUrl = linkMatch ? linkMatch[1] : "";
      
      // Extract pubDate
      const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const pubDateStr = pubDateMatch ? pubDateMatch[1] : "";
      let publishedAt = "";
      if (pubDateStr) {
        try {
          publishedAt = new Date(pubDateStr).toISOString();
        } catch {
          publishedAt = new Date().toISOString();
        }
      } else {
        publishedAt = new Date().toISOString();
      }
      
      // Extract source
      const sourceMatch = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      let source = sourceMatch ? sourceMatch[1] : "Google News";
      
      // Clean up title (remove " - Source" suffix if present)
      let title = fullTitle;
      if (source && title.endsWith(` - ${source}`)) {
        title = title.substring(0, title.length - ` - ${source}`.length);
      } else {
        const lastDashIndex = title.lastIndexOf(" - ");
        if (lastDashIndex > 0) {
          title = title.substring(0, lastDashIndex);
        }
      }
      
      // Extract description
      const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/);
      let description = descMatch ? descMatch[1] : "";
      description = description.replace(/<[^>]*>/g, "").trim(); // strip HTML tags
      
      articles.push({
        title: decodeHtmlEntities(title).trim(),
        source: decodeHtmlEntities(source).trim(),
        publishedAt,
        url: linkUrl,
        description: decodeHtmlEntities(description).substring(0, 400).trim(),
      });
    }

    return { found: articles.length > 0, articles };
  } catch (err: any) {
    return { found: false, articles: [], error: err.message };
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Fetches recent news for a company. Tries NewsAPI first (if key available),
 * falls back to Google News RSS search.
 */
export async function fetchCompanyNews(companyName: string): Promise<NewsResult> {
  // Try NewsAPI first
  const newsApiResult = await fetchFromNewsAPI(companyName);
  if (newsApiResult.found) return newsApiResult;

  // Fall back to Google News RSS
  const googleNewsResult = await fetchFromGoogleNewsRSS(companyName);
  return googleNewsResult;
}
