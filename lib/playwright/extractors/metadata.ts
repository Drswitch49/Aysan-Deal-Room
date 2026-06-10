import type { Page } from "playwright-core";

export interface MetadataExtraction {
  title: string;
  description: string;
  keywords: string;
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  technologies: string[];
  pageStructure: {
    headings: Record<string, number>;
    linksCount: number;
    imagesCount: number;
  };
}

export async function extractMetadata(page: Page): Promise<MetadataExtraction> {
  return page.evaluate(() => {
    const getMeta = (nameOrProperty: string): string => {
      const el =
        document.querySelector(`meta[name='${nameOrProperty}']`) ||
        document.querySelector(`meta[property='${nameOrProperty}']`);
      return el?.getAttribute("content")?.trim() || "";
    };

    // 1. Gather meta tags
    const title = document.title || "";
    const description = getMeta("description");
    const keywords = getMeta("keywords");

    // OpenGraph
    const openGraph: Record<string, string> = {
      title: getMeta("og:title"),
      description: getMeta("og:description"),
      type: getMeta("og:type"),
      url: getMeta("og:url"),
      siteName: getMeta("og:site_name"),
    };

    // Twitter
    const twitterCard: Record<string, string> = {
      card: getMeta("twitter:card"),
      title: getMeta("twitter:title"),
      description: getMeta("twitter:description"),
      site: getMeta("twitter:site"),
    };

    // 2. Identify technology indicators
    const technologies: string[] = [];
    const htmlString = document.documentElement.outerHTML.toLowerCase();

    // Content management / platform
    if (htmlString.includes("wp-content") || htmlString.includes("wordpress")) technologies.push("WordPress");
    if (htmlString.includes("shopify")) technologies.push("Shopify");
    if (htmlString.includes("webflow")) technologies.push("Webflow");
    if (htmlString.includes("squarespace")) technologies.push("Squarespace");
    if (htmlString.includes("wix.com")) technologies.push("Wix");
    if (htmlString.includes("woocommerce")) technologies.push("WooCommerce");
    if (htmlString.includes("hubspot")) technologies.push("HubSpot");

    // Analytics / scripts
    if (htmlString.includes("google-analytics") || htmlString.includes("googletagmanager")) {
      technologies.push("Google Tag Manager / Analytics");
    }
    if (htmlString.includes("facebook-jssdk") || htmlString.includes("fbevents.js")) {
      technologies.push("Facebook Pixel");
    }

    // Libraries / frameworks
    if (htmlString.includes("_next/static") || (window as any).__NEXT_DATA__) technologies.push("Next.js");
    if (htmlString.includes("react")) technologies.push("React");
    if (htmlString.includes("vue")) technologies.push("Vue.js");
    if (htmlString.includes("jquery")) technologies.push("jQuery");

    // 3. Page structure
    const headings: Record<string, number> = {
      h1: document.querySelectorAll("h1").length,
      h2: document.querySelectorAll("h2").length,
      h3: document.querySelectorAll("h3").length,
    };

    const linksCount = document.querySelectorAll("a").length;
    const imagesCount = document.querySelectorAll("img").length;

    return {
      title,
      description,
      keywords,
      openGraph,
      twitterCard,
      technologies,
      pageStructure: {
        headings,
        linksCount,
        imagesCount,
      },
    };
  });
}
