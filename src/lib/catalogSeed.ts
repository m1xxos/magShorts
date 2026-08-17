// Publications the catalog starts from, chosen against what actually gets
// saved in this reader: internet culture, social trends, media criticism and
// technology's effect on ordinary life — the register of "Our Last Wi-Fi-Less
// Refuge Is Gone" and "Which Screen Is the 'Good Screen' Now?", not gadget
// reviews.
//
// These are home-page URLs, not feed URLs, on purpose: every one is put
// through discoverFeedUrl before it enters the catalog, so a publication that
// moved, died or never had a feed is rejected instead of becoming a broken
// row. The list is a starting point for the model's suggestions to build on,
// not a fixed catalog.

export interface SeedEntry {
  name: string;
  url: string;
}

export const CATALOG_SEED: SeedEntry[] = [
  // Essays and ideas
  { name: "Aeon", url: "https://aeon.co" },
  { name: "Nautilus", url: "https://nautil.us" },
  { name: "Noema Magazine", url: "https://www.noemamag.com" },
  { name: "The Baffler", url: "https://thebaffler.com" },
  { name: "n+1", url: "https://www.nplusonemag.com" },
  { name: "The New Yorker", url: "https://www.newyorker.com" },
  { name: "Public Books", url: "https://www.publicbooks.org" },
  { name: "The Marginalian", url: "https://www.themarginalian.org" },
  { name: "Longreads", url: "https://longreads.com" },

  // Internet culture and media criticism
  { name: "404 Media", url: "https://www.404media.co" },
  { name: "Rest of World", url: "https://restofworld.org" },
  { name: "Defector", url: "https://defector.com" },
  { name: "Undark", url: "https://undark.org" },
  { name: "Culture Study", url: "https://annehelen.substack.com" },
  { name: "The Pudding", url: "https://pudding.cool" },
  { name: "Literary Hub", url: "https://lithub.com" },
  { name: "Dirt", url: "https://dirt.fyi" },
  { name: "Embedded", url: "https://embedded.substack.com" },
  { name: "Web Curios", url: "https://www.webcurios.co.uk" },
  { name: "The Honest Broker", url: "https://www.honest-broker.com" },
  { name: "Real Life", url: "https://reallifemag.com" },

  // Technology and society
  { name: "MIT Technology Review", url: "https://www.technologyreview.com" },
  { name: "Ars Technica", url: "https://arstechnica.com" },
  { name: "Platformer", url: "https://www.platformer.news" },
  { name: "Astral Codex Ten", url: "https://www.astralcodexten.com" },
  { name: "Vox", url: "https://www.vox.com" },
  { name: "Quanta Magazine", url: "https://www.quantamagazine.org" },
  { name: "Works in Progress", url: "https://worksinprogress.co" },
  { name: "Asterisk Magazine", url: "https://asteriskmag.com" },
  { name: "Palladium", url: "https://www.palladiummag.com" },
];
