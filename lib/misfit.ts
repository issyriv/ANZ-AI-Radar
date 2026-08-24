// Deterministic thesis-misfit detection.
//
// A cheap first pass so the ranking can be corrected without paying to re-score
// every company. The model does this properly during extraction (see
// lib/extract.ts); this catches the obvious cases in data already stored.
//
// The healthcare split is the part that matters and the part that is easy to get
// wrong. The fund actively buys clinical WORKFLOW software — Tandem Health, a
// clinical scribe, is a portfolio company — while therapeutics and drug
// discovery are explicitly out of scope. So "healthcare" alone decides nothing;
// the distinction is whether the product is software in a care workflow or a
// pipeline toward a molecule.

export interface MisfitVerdict {
  misfit: boolean;
  reason: string | null;
}

/** Therapeutics / drug discovery — out of scope. */
const DRUG_DISCOVERY =
  /\b(drug discovery|drug development|therapeutic|therapeutics|preclinical|pre-clinical|clinical trial|small molecule|molecule design|oncolog|antibod|vaccine|gene therapy|cell therapy|biomarker discovery|compound screening|assay|protein design|protein engineering|regenerative medicine|pharmaceutical pipeline)\b/i;

/** Clinical software — explicitly IN scope, overrides a biotech-ish reading. */
const CLINICAL_WORKFLOW =
  /\b(clinical documentation|scribe|ambient documentation|care operations|patient record|electronic health record|\behr\b|\bemr\b|triage|referral|rota|scheduling|billing|coding|claims|care pathway|practice management|clinical workflow|back.?office)\b/i;

/**
 * Generic AI productivity tooling — the fund says these mostly die.
 *
 * "AI assistant for X" is deliberately NOT here. It is too broad: it flagged an
 * in-house legal AI, which is the exact shape of GC AI, a portfolio company.
 * The distinction the fund draws is horizontal convenience versus AI doing
 * expert work in a domain, so the domain guard below has to clear first.
 */
const PRODUCTIVITY_TOOL =
  /\b(note.?tak|meeting (notes|summar|assistant|recorder)|transcription app|summaris\w+ tool|generic copilot|chatbot builder|prompt (library|manager|engineering tool)|writing assistant|email assistant|slide deck generator|productivity suite|task manager)\b/i;

/**
 * Expert domains the fund actively buys. AI doing expert work in one of these is
 * the thesis, not a productivity tool, however "assistant"-shaped it sounds.
 */
const EXPERT_DOMAIN =
  /\b(legal|law|litigation|compliance|regulatory|financial|finance|banking|insurance|underwrit|accounting|audit|tax|clinical|medical|healthcare|diagnos|industrial|manufactur|supply chain|logistics|engineering|security|defence|defense|threat|pentest|robotic|autonomous)\b/i;

/** Hardware with no compounding software layer. */
const PURE_HARDWARE =
  /\b(semiconductor fab|chip fabrication|contract manufactur|hardware manufactur|sensor manufactur|component supplier|pcb|electronics assembly)\b/i;

/** Consumer-only, no enterprise or expert-work wedge. */
const PURE_CONSUMER =
  /\b(dating app|social network for|consumer marketplace|food delivery|meal kit|fashion (brand|retail)|beauty brand|fitness app|game studio|mobile game|travel booking|ticketing app)\b/i;

export function classifyMisfit(text: string): MisfitVerdict {
  const t = text.toLowerCase();
  if (DRUG_DISCOVERY.test(t) && !CLINICAL_WORKFLOW.test(t)) {
    return { misfit: true, reason: "drug_discovery" };
  }
  if (PRODUCTIVITY_TOOL.test(t) && !EXPERT_DOMAIN.test(t)) {
    return { misfit: true, reason: "ai_productivity_tool" };
  }
  if (PURE_HARDWARE.test(t)) return { misfit: true, reason: "pure_hardware" };
  if (PURE_CONSUMER.test(t)) return { misfit: true, reason: "pure_consumer" };
  return { misfit: false, reason: null };
}
