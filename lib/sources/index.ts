// The live source registry.
//
// Every entry here was triaged by `npx tsx scripts/probe.ts` (see
// ./candidates.ts for the raw universe). `mode` records what that triage found:
//
//   "auto"     — plain HTTP works today; fall back to headless if the site
//                changes and starts returning a thin shell.
//   "headless" — known client-rendered, bot-checked, or client-routed. Skips a
//                wasted HTTP round trip.
//
// Re-run the probe after a site redesign and move entries between modes.

import type { FetchMode } from "../fetcher";
import type { RenderOptions } from "../browser";

export type SourceType =
  | "publication"
  | "vc_portfolio"
  | "accelerator"
  | "university"
  | "incubator"; // pre-investment: university programmes, studios, cohort schemes

export interface FeedSource {
  name: string;
  url: string;
  /** Pan-European or global feeds carry a lot of non-UK noise. */
  broad?: boolean;
}

export interface PortfolioSource {
  name: string;
  sourceType: SourceType;
  url: string;
  mode: FetchMode;
  render?: RenderOptions;
}

// --- Publications (RSS) -----------------------------------------------------

export const FEEDS: FeedSource[] = [
  { name: "UKTN", url: "https://www.uktech.news/feed" },
  { name: "Sifted", url: "https://sifted.eu/feed", broad: true },
  { name: "BusinessCloud", url: "https://businesscloud.co.uk/feed/" },
  { name: "TechRound", url: "https://techround.co.uk/feed/" },
  { name: "Startups Magazine", url: "https://startupsmagazine.co.uk/feed" },
  { name: "Maddyness UK", url: "https://www.maddyness.com/uk/feed/" },
  { name: "Tech.eu", url: "https://tech.eu/feed/", broad: true },
  { name: "EU-Startups", url: "https://www.eu-startups.com/feed/", broad: true },
  { name: "Silicon Canals", url: "https://siliconcanals.com/feed/", broad: true },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", broad: true },

  // --- Funding-round trackers and regional trade press ------------------------
  //
  // Direct analogues of what the ANZ build relied on. The ANZ version had a
  // dedicated funding tracker (Cut Through Venture) plus national and regional
  // trade press; the UK set had neither until now, which is why coverage skewed
  // hard to London-and-London-only.
  //
  // Measured relevance from a live probe (funding-shaped headlines per fetch):
  //   UKBAA 5/10, Bdaily 4/12, City AM 2/30, DIGIT 1/15, FutureScot 1/10.

  // Angel and pre-seed rounds — the closest thing to a UK Cut Through Venture,
  // and pitched at exactly the stage this radar cares about.
  { name: "UK Business Angels Association", url: "https://ukbaa.org.uk/feed/" },

  // Regional press. London-centric feeds simply do not report an Edinburgh or
  // Cardiff seed round, so these are coverage, not redundancy.
  { name: "Bdaily", url: "https://bdaily.co.uk/rss" },
  { name: "Prolific North", url: "https://www.prolificnorth.co.uk/feed/" },
  { name: "DIGIT Scotland", url: "https://www.digit.fyi/feed/" },
  { name: "FutureScot", url: "https://futurescot.com/feed/" },
  { name: "Business News Wales", url: "https://businessnewswales.com/feed/" },
  { name: "City AM", url: "https://www.cityam.com/feed/", broad: true },
  { name: "Global Venturing", url: "https://globalventuring.com/feed/", broad: true },
];

// --- Portfolio / cohort pages ----------------------------------------------

export const PORTFOLIOS: PortfolioSource[] = [
  // The fund itself — its own portfolio is both a source and the alumni list.
  { name: "Northzone", sourceType: "vc_portfolio", url: "https://northzone.com/portfolio/", mode: "auto" },

  // London / UK venture.
  // LocalGlobe and Latitude both render from the Phoenix Court site; their own
  // domains serve an empty shell behind a Cookiebot overlay.
  { name: "Phoenix Court (LocalGlobe/Latitude)", sourceType: "vc_portfolio", url: "https://www.phoenixcourt.vc/companies", mode: "headless" },
  { name: "Phoenix Court", sourceType: "vc_portfolio", url: "https://phoenixcourt.com/portfolio/", mode: "auto" },
  // Atomico no longer publishes a portfolio index; its site links only to
  // individual investment posts. Removed rather than left returning a 404.
  { name: "Balderton", sourceType: "vc_portfolio", url: "https://www.balderton.com/companies/", mode: "auto" },
  { name: "Index Ventures", sourceType: "vc_portfolio", url: "https://www.indexventures.com/companies/", mode: "auto" },
  { name: "Accel", sourceType: "vc_portfolio", url: "https://www.accel.com/companies", mode: "headless" },
  { name: "Hoxton Ventures", sourceType: "vc_portfolio", url: "https://hoxtonventures.com/portfolio/", mode: "auto" },
  { name: "Concept Ventures", sourceType: "vc_portfolio", url: "https://www.conceptventures.vc/portfolio", mode: "auto" },
  { name: "Episode 1", sourceType: "vc_portfolio", url: "https://episode1.com/portfolio/", mode: "auto" },
  { name: "Ada Ventures", sourceType: "vc_portfolio", url: "https://www.adaventures.com/categories/portfolio", mode: "headless" },
  { name: "Playfair Capital", sourceType: "vc_portfolio", url: "https://playfair.vc/portfolio.php", mode: "auto" },
  { name: "Amadeus Capital", sourceType: "vc_portfolio", url: "https://www.amadeuscapital.com/our-companies/", mode: "headless" },
  { name: "IQ Capital", sourceType: "vc_portfolio", url: "https://www.iqcapital.vc/companies", mode: "auto" },
  { name: "Octopus Ventures", sourceType: "vc_portfolio", url: "https://octopusventures.com/portfolio/", mode: "auto" },
  { name: "MMC Ventures", sourceType: "vc_portfolio", url: "https://mmc.vc/portfolio/", mode: "auto" },
  { name: "Dawn Capital", sourceType: "vc_portfolio", url: "https://dawncapital.com/companies", mode: "auto" },
  { name: "Air Street Capital", sourceType: "vc_portfolio", url: "https://www.airstreet.com/portfolio", mode: "auto" },
  { name: "Kindred Capital", sourceType: "vc_portfolio", url: "https://kindredcapital.vc/portfolio/", mode: "auto" },
  { name: "Passion Capital", sourceType: "vc_portfolio", url: "https://passioncapital.com/fund-portfolio/", mode: "auto" },
  { name: "firstminute capital", sourceType: "vc_portfolio", url: "https://www.firstminute.capital/portfolio", mode: "headless", render: { scroll: true, deadlineMs: 60_000 } },
  { name: "Fuel Ventures", sourceType: "vc_portfolio", url: "https://fuel.ventures/portfolio/", mode: "auto" },
  { name: "Molten Ventures", sourceType: "vc_portfolio", url: "https://www.moltenventures.com/portfolio/", mode: "auto" },
  { name: "Eka Ventures", sourceType: "vc_portfolio", url: "https://www.ekavc.com/portfolio", mode: "auto" },
  { name: "Connect Ventures", sourceType: "vc_portfolio", url: "https://www.connectventures.co.uk/portfolio", mode: "auto" },
  { name: "Frontline Ventures", sourceType: "vc_portfolio", url: "https://frontline.vc/companies/", mode: "auto" },
  { name: "AlbionVC", sourceType: "vc_portfolio", url: "https://albion.vc/portfolio/", mode: "auto" },
  { name: "Notion Capital", sourceType: "vc_portfolio", url: "https://notion.vc/portfolio/", mode: "auto" },
  { name: "83North", sourceType: "vc_portfolio", url: "https://www.83north.com/companies/", mode: "auto" },
  { name: "Crane Venture Partners", sourceType: "vc_portfolio", url: "https://crane.vc/portfolio/", mode: "auto" },
  { name: "Moonfire Ventures", sourceType: "vc_portfolio", url: "https://www.moonfire.com/portfolio", mode: "auto" },
  { name: "Backed VC", sourceType: "vc_portfolio", url: "https://backed.vc/portfolio", mode: "auto" },
  { name: "Anthemis", sourceType: "vc_portfolio", url: "https://www.anthemis.com/portfolio/", mode: "auto" },
  { name: "Augmentum Fintech", sourceType: "vc_portfolio", url: "https://www.augmentum.vc/portfolio/", mode: "headless" },
  { name: "Lakestar", sourceType: "vc_portfolio", url: "https://www.lakestar.com/portfolio", mode: "headless" },
  { name: "Speedinvest", sourceType: "vc_portfolio", url: "https://www.speedinvest.com/portfolio", mode: "auto" },
  { name: "Oxford Capital", sourceType: "vc_portfolio", url: "https://oxcp.com/portfolio/", mode: "auto" },
  { name: "Mercia Ventures", sourceType: "vc_portfolio", url: "https://www.mercia.co.uk/portfolio/", mode: "auto" },
  { name: "Praetura Ventures", sourceType: "vc_portfolio", url: "https://praetura.co.uk/portfolio/", mode: "headless" },
  { name: "Northern Gritstone", sourceType: "vc_portfolio", url: "https://northerngritstone.com/portfolio/", mode: "headless" },
  { name: "Ascension", sourceType: "vc_portfolio", url: "https://ascension.vc/portfolio/", mode: "auto" },
  { name: "Haatch", sourceType: "vc_portfolio", url: "https://haatch.com/portfolio/", mode: "auto" },
  { name: "SuperSeed", sourceType: "vc_portfolio", url: "https://superseed.com/portfolio/", mode: "auto" },
  { name: "AENU", sourceType: "vc_portfolio", url: "https://www.aenu.com/portfolio", mode: "auto" },
  { name: "Emerge Education", sourceType: "vc_portfolio", url: "https://emerge.education/portfolio/", mode: "auto" },

  // Accelerators, studios and talent-first programmes.
  { name: "Entrepreneur First", sourceType: "accelerator", url: "https://www.joinef.com/companies/", mode: "auto" },
  { name: "Seedcamp", sourceType: "accelerator", url: "https://seedcamp.com/companies/", mode: "auto" },
  { name: "Founders Factory", sourceType: "accelerator", url: "https://foundersfactory.com/portfolio/", mode: "auto" },
  { name: "Antler UK", sourceType: "accelerator", url: "https://www.antler.co/portfolio", mode: "auto" },
  { name: "Techstars London", sourceType: "accelerator", url: "https://www.techstars.com/portfolio", mode: "auto" },
  { name: "Bethnal Green Ventures", sourceType: "accelerator", url: "https://bethnalgreenventures.com/portfolio/", mode: "auto" },
  { name: "Carbon13", sourceType: "accelerator", url: "https://carbonthirteen.com/ventures/", mode: "auto" },
  { name: "Zinc VC", sourceType: "accelerator", url: "https://www.zinc.vc/portfolio-companies/", mode: "headless" },
  { name: "Conception X", sourceType: "accelerator", url: "https://www.conceptionx.org/portfolio", mode: "auto" },

  // --- Pre-investment: incubators, university programmes, cohort schemes -----
  //
  // The point of this block is companies that have taken NO equity yet, or at
  // most a small pre-seed cheque. University programmes are the purest form:
  // the ventures are often student- or researcher-founded and pre-any-raise.
  { name: "SFC Capital", sourceType: "incubator", url: "https://sfccapital.com/portfolio/", mode: "auto" },
  { name: "Startup Wise Guys", sourceType: "incubator", url: "https://startupwiseguys.com/portfolio/", mode: "auto" },
  { name: "Kings20 Accelerator", sourceType: "incubator", url: "https://www.kcl.ac.uk/entrepreneurship-institute/kings20-accelerator", mode: "auto" },
  { name: "LSE Generate", sourceType: "incubator", url: "https://www.lse.ac.uk/lse-generate/our-startups", mode: "auto" },
  { name: "SETsquared", sourceType: "incubator", url: "https://www.setsquared.co.uk/companies/", mode: "auto" },
  { name: "Edinburgh Innovations", sourceType: "incubator", url: "https://edinburgh-innovations.ed.ac.uk/our-companies", mode: "auto" },
  { name: "Accelerate Cambridge", sourceType: "incubator", url: "https://www.jbs.cam.ac.uk/entrepreneurship/programmes/accelerate-cambridge/", mode: "auto" },
  { name: "Digital Catapult", sourceType: "incubator", url: "https://www.digicatapult.org.uk/programmes/", mode: "auto" },
  { name: "Oxford Foundry", sourceType: "incubator", url: "https://www.oxfordfoundry.ox.ac.uk/our-ventures", mode: "headless" },
  { name: "Deeptech Labs", sourceType: "incubator", url: "https://deeptechlabs.com/portfolio/", mode: "headless" },
  { name: "Imperial Venture Lab", sourceType: "incubator", url: "https://www.imperialenterpriselab.com/our-startups/", mode: "headless" },
  { name: "UCL Hatchery", sourceType: "incubator", url: "https://www.ucl.ac.uk/enterprise/entrepreneurs/ucl-hatchery", mode: "headless" },
  { name: "Converge Scotland", sourceType: "incubator", url: "https://www.converge.scot/alumni/", mode: "headless" },
  { name: "Techstart Ventures", sourceType: "incubator", url: "https://www.techstart.vc/portfolio/", mode: "headless" },
  { name: "Panacea Innovation", sourceType: "incubator", url: "https://panaceastars.com/portfolio", mode: "headless" },

  // University tech transfer and deep-tech spinout vehicles.
  { name: "Oxford Science Enterprises", sourceType: "university", url: "https://oxfordscienceenterprises.com/portfolio/", mode: "auto" },
  { name: "Cambridge Enterprise", sourceType: "university", url: "https://www.enterprise.cam.ac.uk/portfolio/", mode: "auto" },
  { name: "UCL Business", sourceType: "university", url: "https://www.uclb.com/spinout-portfolio", mode: "auto" },
  { name: "Deep Science Ventures", sourceType: "university", url: "https://deepscienceventures.com/our-portfolio", mode: "auto" },
  { name: "Parkwalk Advisors", sourceType: "university", url: "https://parkwalkadvisors.com/portfolio/", mode: "auto" },
];

// --- Paginated article listings (crawled for depth beyond the RSS window) ----

export const LISTINGS: { name: string; base: string; pattern: RegExp; pages: number }[] = [
  {
    name: "UKTN",
    base: "https://www.uktech.news/tag/funding/",
    pattern: /https:\/\/www\.uktech\.news\/[a-z0-9-]+\/[a-z0-9-]{12,}/g,
    pages: 5,
  },
];

export const SOURCE_COUNT = FEEDS.length + PORTFOLIOS.length + LISTINGS.length + 1; // +1 = YC directory
