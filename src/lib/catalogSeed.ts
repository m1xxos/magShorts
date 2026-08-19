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

  // Writers who work alone. The catalog leaned institutional — magazines with
  // mastheads — and the saved articles do not: half of them are one person
  // paying attention in public.
  //
  // Some obvious names are missing because they serve no feed anyone can
  // reach: Garbage Day and Today in Tabs answer 404 on every conventional
  // path, and The Paris Review, LARB and The Hedgehog Review sit behind a bot
  // wall that returns 403 to everything. They were here, they were verified,
  // they failed.
  { name: "Blood in the Machine", url: "https://www.bloodinthemachine.com" },
  { name: "Citation Needed", url: "https://www.citationneeded.news" },
  { name: "Pluralistic", url: "https://pluralistic.net" },
  { name: "Where's Your Ed At", url: "https://www.wheresyoured.at" },
  { name: "Read Max", url: "https://maxread.substack.com" },
  { name: "Waxy", url: "https://waxy.org" },
  { name: "kottke.org", url: "https://kottke.org" },
  { name: "Craig Mod", url: "https://craigmod.com" },
  { name: "Robin Sloan", url: "https://www.robinsloan.com" },
  // The one feed URL in the list: this site advertises no feed from its home
  // page, and discoverFeedUrl accepts a feed URL as readily as a home page.
  { name: "Interconnected", url: "https://interconnected.org/home/feed" },
  { name: "Anil Dash", url: "https://anildash.com" },
  { name: "One Useful Thing", url: "https://www.oneusefulthing.org" },

  // Reported internet culture, from newsrooms small enough to have a voice
  { name: "Aftermath", url: "https://aftermath.site" },
  { name: "Techdirt", url: "https://www.techdirt.com" },
  { name: "Hell Gate", url: "https://hellgatenyc.com" },
  { name: "Tedium", url: "https://tedium.co" },
  { name: "The Gradient", url: "https://thegradient.pub" },

  // Longer forms: essays, criticism, reviews
  { name: "London Review of Books", url: "https://www.lrb.co.uk" },
  { name: "The Public Domain Review", url: "https://publicdomainreview.org" },
  { name: "The Millions", url: "https://themillions.com" },
  { name: "The Point", url: "https://thepointmag.com" },
  { name: "The Drift", url: "https://www.thedriftmag.com" },
  { name: "Granta", url: "https://granta.com" },
  { name: "Jacobin", url: "https://jacobin.com" },

  // Science and the world, written for readers rather than colleagues
  { name: "JSTOR Daily", url: "https://daily.jstor.org" },
  { name: "Knowable Magazine", url: "https://knowablemagazine.org" },
  { name: "Sapiens", url: "https://www.sapiens.org" },
  { name: "Emergence Magazine", url: "https://emergencemagazine.org" },
  { name: "Low-tech Magazine", url: "https://solar.lowtechmagazine.com" },
];
