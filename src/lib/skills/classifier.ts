import { PurchaseOrderLineStatus } from "@prisma/client";

import type {
  ClassificationResult,
  SkillContext,
  SupplierIntent,
  SUPPLIER_INTENTS,
} from "./types";
import { buildLinesContext, buildThreadContext, invokeLLMJson } from "./utils";

// ── Pre-Classification (rule-based narrowing) ──────────────────────────────────

/**
 * Narrow the set of candidate intents based on PO/line state.
 * This runs before the LLM call to reduce ambiguity and cost.
 */
export function preClassify(ctx: SkillContext): SupplierIntent[] {
  const poStatus = ctx.poStatus;
  const lineStatuses = ctx.openLines.map((l) => l.lineStatus);
  const allLineStatuses = ctx.allLines.map((l) => l.lineStatus);

  const candidates = new Set<SupplierIntent>();

  // PO awaiting initial acknowledgment
  if (poStatus === "SENT" || poStatus === "ACK_PENDING") {
    candidates.add("acknowledgment");
    candidates.add("date_confirmation");
    candidates.add("date_rejection");
    candidates.add("deferral");
    candidates.add("general");
  }

  // Any open line is overdue
  if (lineStatuses.includes(PurchaseOrderLineStatus.OVERDUE)) {
    candidates.add("rescheduling");
    candidates.add("staggered_delivery");
    candidates.add("deferral");
    candidates.add("general");
  }

  // Lines pending confirmation or in negotiation
  if (
    lineStatuses.includes(PurchaseOrderLineStatus.DATE_NEGOTIATION) ||
    lineStatuses.includes(PurchaseOrderLineStatus.PENDING_CONFIRMATION)
  ) {
    candidates.add("date_confirmation");
    candidates.add("date_rejection");
    candidates.add("deferral");
    candidates.add("general");
  }

  // PO partially received — remaining quantities may need rescheduling
  if (
    poStatus === "PARTIALLY_RECEIVED" ||
    allLineStatuses.includes(PurchaseOrderLineStatus.PARTIALLY_RECEIVED)
  ) {
    candidates.add("staggered_delivery");
    candidates.add("rescheduling");
    candidates.add("general");
  }

  // PO already acknowledged — supplier may reschedule previously committed dates
  if (poStatus === "ACKNOWLEDGED") {
    candidates.add("rescheduling");
    candidates.add("date_confirmation");
    candidates.add("general");
  }

  // Fallback: if no rules matched, allow all intents
  if (candidates.size === 0) {
    return [...(["acknowledgment", "date_confirmation", "date_rejection", "staggered_delivery", "rescheduling", "deferral", "general"] as const)];
  }

  return [...candidates];
}

// ── LLM Classification ────────────────────────────────────────────────────────

interface LLMClassificationResponse {
  intent: string;
  confidence: number;
  reasoning: string;
}

/**
 * Classify the supplier message intent using an LLM.
 * Falls back to keyword matching on failure.
 */
export async function classifyIntent(
  ctx: SkillContext,
  message: string,
  candidates: SupplierIntent[],
): Promise<ClassificationResult> {
  // If no API key, use keyword fallback directly
  if (!process.env.OPENAI_API_KEY) {
    return classifyByKeywords(message, candidates);
  }

  const linesContext = buildLinesContext(ctx);
  const threadContext = buildThreadContext(ctx, 4);

  const intentDescriptions = candidates
    .map((intent) => `  - "${intent}": ${INTENT_DESCRIPTIONS[intent]}`)
    .join("\n");

  const systemPrompt = `You are a procurement intent classifier. Given a supplier's email reply and PO context, classify the supplier's primary intent.

Today's date: ${ctx.todayStr}
PO: ${ctx.poNumber} (Status: ${ctx.poStatus})
Supplier: ${ctx.supplierName}

Open PO Lines:
${linesContext}

Recent thread:
${threadContext}

Possible intents:
${intentDescriptions}

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "intent": "one of the intent names listed above",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence explaining why this intent was chosen"
}

Rules:
- Pick the SINGLE most specific intent that matches the supplier's message.
- If the supplier both acknowledges AND provides dates, prefer "date_confirmation" or "date_rejection" over "acknowledgment".
- If the supplier mentions multiple delivery splits (date+quantity pairs), prefer "staggered_delivery".
- If the supplier says they will respond later, prefer "deferral".
- Only use "general" if no other intent fits.
- Confidence should reflect how clearly the message matches the intent.`;

  try {
    const result = await invokeLLMJson<LLMClassificationResponse>(
      ctx.model,
      systemPrompt,
      `Supplier email:\n\n${message}`,
    );

    if (result && isValidIntent(result.intent, candidates)) {
      return {
        intent: result.intent as SupplierIntent,
        confidence: Math.min(1, Math.max(0, result.confidence ?? 0.5)),
        reasoning: result.reasoning ?? "",
        candidateIntents: candidates,
      };
    }

    // LLM returned invalid intent — fall back
    return classifyByKeywords(message, candidates);
  } catch (error) {
    console.error("LLM classification failed, using keyword fallback:", error);
    return classifyByKeywords(message, candidates);
  }
}

// ── Keyword Fallback ───────────────────────────────────────────────────────────

const KEYWORD_PATTERNS: Array<{
  intent: SupplierIntent;
  patterns: RegExp[];
  confidence: number;
}> = [
  {
    intent: "staggered_delivery",
    patterns: [
      /\bstagger/i,
      /\bsplit\s+deliver/i,
      /\bpartial\s+(?:deliver|ship)/i,
      /\d+\s*(?:kg|pcs|units|mt|tons?)?\s*(?:by|on)\s*\d{4}-?\d{2}-?\d{2}.*\d+\s*(?:kg|pcs|units|mt|tons?)?\s*(?:by|on)\s*\d{4}-?\d{2}-?\d{2}/i,
    ],
    confidence: 0.7,
  },
  {
    intent: "date_rejection",
    patterns: [
      /\bnot\s+feasible\b/i,
      /\bcannot\s+meet\b/i,
      /\bcan(?:'t|not)\s+(?:deliver|ship|meet)\b/i,
      /\bearliest\s+(?:feasible|possible|available)\b/i,
      /\bcounter[- ]?propos/i,
      /\binstead\s+of\b/i,
    ],
    confidence: 0.7,
  },
  {
    intent: "rescheduling",
    patterns: [
      /\brevis(?:e|ed)\s+(?:date|delivery|schedule)/i,
      /\breschedul/i,
      /\bnew\s+(?:date|edd|delivery\s+date)/i,
      /\bdelay(?:ed)?\b/i,
      /\bshortage\b/i,
      /\bpush(?:ed)?\s+(?:back|to)\b/i,
    ],
    confidence: 0.65,
  },
  {
    intent: "deferral",
    patterns: [
      /\bwill\s+confirm\b/i,
      /\bwill\s+(?:get\s+back|revert|respond)\b/i,
      /\bby\s+tomorrow\b/i,
      /\bby\s+end\s+of\b/i,
      /\bby\s+(?:next\s+)?(?:week|monday|friday)\b/i,
      /\bin\s+\d+\s+(?:day|hour)/i,
      /\bneed\s+(?:some\s+)?(?:time|more\s+time)\b/i,
      /\bcheck(?:ing)?\s+(?:with|internally)\b/i,
    ],
    confidence: 0.7,
  },
  {
    intent: "date_confirmation",
    patterns: [
      /\bconfirm(?:ed|ing)?\s+(?:the\s+)?(?:date|delivery|edd)/i,
      /\bcan\s+deliver\s+by\b/i,
      /\bwill\s+(?:deliver|ship)\s+(?:by|on)\b/i,
      /\bpromised?\s+date\b/i,
      /\bagreed?\s+(?:to|date)/i,
      /\bas\s+requested\b/i,
    ],
    confidence: 0.7,
  },
  {
    intent: "acknowledgment",
    patterns: [
      /\backnowledg/i,
      /\bpo\s+(?:is\s+)?(?:accepted|received|noted)\b/i,
      /\bconfirm(?:ed|ing)?\s+(?:the\s+)?(?:po|purchase\s+order|order)\b/i,
      /\bwe\s+(?:have\s+)?received\s+(?:the\s+)?(?:po|purchase\s+order|order)\b/i,
    ],
    confidence: 0.65,
  },
  {
    intent: "general",
    patterns: [
      /\bspec(?:ification)?s?\b/i,
      /\bquestion\b/i,
      /\bplease\s+(?:share|provide|send|clarify)\b/i,
      /\bregarding\b/i,
    ],
    confidence: 0.4,
  },
];

/**
 * Classify intent using keyword/regex patterns.
 * Used as fallback when LLM is unavailable or fails.
 */
export function classifyByKeywords(
  message: string,
  candidates: SupplierIntent[],
): ClassificationResult {
  // Try patterns in priority order (most specific first)
  for (const { intent, patterns, confidence } of KEYWORD_PATTERNS) {
    if (!candidates.includes(intent)) continue;

    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return {
          intent,
          confidence,
          reasoning: `Keyword match: ${pattern.source}`,
          candidateIntents: candidates,
        };
      }
    }
  }

  // Default to "general" if it's a candidate, otherwise first candidate
  const fallbackIntent = candidates.includes("general")
    ? "general"
    : candidates[0];

  return {
    intent: fallbackIntent,
    confidence: 0.3,
    reasoning: "No keyword patterns matched. Defaulting to fallback intent.",
    candidateIntents: candidates,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const INTENT_DESCRIPTIONS: Record<SupplierIntent, string> = {
  acknowledgment:
    "Supplier acknowledges receipt of the PO, optionally confirms dates.",
  date_confirmation:
    "Supplier confirms they can deliver by the requested or acceptable date.",
  date_rejection:
    "Supplier rejects the requested date and proposes a counter-date.",
  staggered_delivery:
    "Supplier proposes splitting delivery into multiple shipments with different dates and quantities.",
  rescheduling:
    "Supplier revises a previously committed date due to delays, shortages, or other issues.",
  deferral:
    "Supplier defers confirmation, saying they will respond/confirm by a later date.",
  general:
    "General inquiry or message not related to delivery dates or acknowledgment.",
};

function isValidIntent(
  intent: string,
  candidates: SupplierIntent[],
): intent is SupplierIntent {
  return candidates.includes(intent as SupplierIntent);
}
