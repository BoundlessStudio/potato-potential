export const site = {
  name: "Potato Potential",
  url: "https://potato-potential.rgbknights.com",
  title: "Potato Potential — Your personal AI companion",
  description:
    "Meet your personal AI companion with a computer of its own. Chat, manage tasks, build a shared wiki, and set routines. Join the invite-only beta.",
  socialImage: {
    path: "/social/potato-potential-social-v1.png",
    width: 1733,
    height: 907,
    alt: "Potato Potential: A little help. A lot of possibility. Four cheerful companions with chat, task, wiki and routine icons.",
  },
} as const;

export const siteStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${site.url}/#organization`,
      name: site.name,
      url: site.url,
      logo: `${site.url}/brand/potato-potential-wordmark.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${site.url}/#website`,
      name: site.name,
      url: site.url,
      description: site.description,
      inLanguage: "en",
      publisher: { "@id": `${site.url}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${site.url}/#application`,
      name: site.name,
      url: site.url,
      description: site.description,
      applicationCategory: "ProductivityApplication",
      operatingSystem: "Web",
      image: `${site.url}${site.socialImage.path}`,
      publisher: { "@id": `${site.url}/#organization` },
      featureList: [
        "Personal AI companion with a persistent computer",
        "Web chat and connected messaging channels",
        "Shared tasks and wiki",
        "Scheduled routines and reminders",
        "Connected apps",
      ],
    },
  ],
};
