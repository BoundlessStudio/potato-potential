import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/beta", "/api/", "/auth/", "/.well-known/workflow/"],
    },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
