import type { Page } from "playwright-core";

export interface SocialExtraction {
  socialLinks: {
    linkedin?: string;
    twitter?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
  };
  schemaMarkup: any[];
}

export async function extractSocialAndSchema(page: Page): Promise<SocialExtraction> {
  return page.evaluate(() => {
    // 1. Social Links extraction
    const socialLinks: SocialExtraction["socialLinks"] = {};
    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href);

    for (const href of links) {
      if (href.includes("linkedin.com/company/") || href.includes("linkedin.com/school/")) {
        socialLinks.linkedin = href;
      } else if (href.includes("twitter.com/") || href.includes("x.com/")) {
        socialLinks.twitter = href;
      } else if (href.includes("facebook.com/")) {
        socialLinks.facebook = href;
      } else if (href.includes("instagram.com/")) {
        socialLinks.instagram = href;
      } else if (href.includes("youtube.com/")) {
        socialLinks.youtube = href;
      }
    }

    // 2. Schema.org JSON-LD parsing
    const schemaMarkup: any[] = [];
    const scriptTags = Array.from(document.querySelectorAll("script[type='application/ld+json']"));

    for (const tag of scriptTags) {
      try {
        const text = tag.textContent?.trim();
        if (text) {
          const parsed = JSON.parse(text);
          // Only store objects, or arrays of objects, that look like schemas
          if (Array.isArray(parsed)) {
            schemaMarkup.push(...parsed.slice(0, 3));
          } else if (typeof parsed === "object" && parsed !== null) {
            schemaMarkup.push(parsed);
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }

    return {
      socialLinks,
      schemaMarkup: schemaMarkup.slice(0, 5), // Keep only top 5 schemas to save storage
    };
  });
}
