// Airtree-shaped durability thesis (from the Q2 application answer): AI-native
// ARR is being mis-classified as SaaS; the durable subset is the one with real
// switching cost, compounding proprietary data, regulated-buyer trust, or
// model-independent distribution. We score each company on these four.

export const DURABILITY_QUESTIONS = [
  {
    key: "switching_cost",
    label: "Switching cost",
    prompt: "Is the product embedded in a workflow that is genuinely painful to rip out?",
  },
  {
    key: "proprietary_data",
    label: "Compounding data",
    prompt: "Does it accumulate proprietary data that compounds with use and competitors cannot replicate?",
  },
  {
    key: "regulated_trust",
    label: "Regulated trust",
    prompt: "Does it sell into regulated/high-trust buyers where credibility takes years to build (legal, health, finance, gov)?",
  },
  {
    key: "distribution",
    label: "Durable distribution",
    prompt: "Is its distribution durable and not dependent on the next foundation model staying mediocre?",
  },
] as const;

export type DurabilityKey = (typeof DURABILITY_QUESTIONS)[number]["key"];
