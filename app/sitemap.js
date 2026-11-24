/**
 * Sitemap for the single-page editorial index. The origin comes from
 * NEXT_PUBLIC_SITE_URL when set (production), falling back to localhost for
 * local verification only — deploy environments should configure the env var.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function sitemap() {
  return [
    {
      url: `${siteUrl}/`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
