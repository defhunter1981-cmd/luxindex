/**
 * robots.txt route. Allows all crawlers by default; the sitemap link is
 * emitted only when a production site URL is configured, so staging
 * environments never advertise a sitemap under the wrong origin.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    ...(siteUrl ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  };
}
