import type { Prisma } from "@prisma/client";

// ── Intent Taxonomy ────────────────────────────────────────────────────────────

export const SUPPLIER_INTENTS = [
  "acknowledgment",
  "date_confirmation",
  "date_rejection",
  "staggered_delivery",
  "rescheduling",
  "deferral",
  "general",
] as const;

export type SupplierIntent = (typeof SUPPLIER_INTENTS)[number];

// ── Context passed to every skill ──────────────────────────────────────────────

/** A PO line with material + latest commitment, as loaded from the DB. */
export type POLineWithDetails = Prisma.PurchaseOrderLineGetPayload<{
  include: {
    material: true;
    deliveryCommitments: true;
  };
}>;

export interface SkillContext {
  threadId: string;
  poId: string;
  poNumber: string;
  poStatus: string;
  supplierName: string;
  supplierEmail: string;
  supplierCcEmails: string[];
  openLines: POLineWithDetails[];
  allLines: POLineWithDetails[];
  threadHistory: Array<{
    direction: string;
    senderType: string | null;
    body: string;
  }>;
  todayStr: string; // YYYY-MM-DD
  model: string; // LLM model name
  useRealEmail: boolean;
}

// ── Classification ─────────────────────────────────────────────────────────────

export interface ClassificationResult {
  intent: SupplierIntent;
  confidence: number; // 0‑1
  reasoning: string;
  candidateIntents: SupplierIntent[];
}

// ── Skill Analysis (returned by each handler's analyze()) ──────────────────────

export interface LineUpdate {
  materialName: string;
  proposedDate: string; // ISO date
  quantity?: number;
  note?: string;
}

export interface StaggeredSplit {
  materialName: string;
  deliveries: Array<{ date: string; quantity: number }>;
}

export interface SkillAnalysisResult {
  intent: SupplierIntent;
  acknowledged: boolean;
  lineUpdates: LineUpdate[];
  followUpBy?: string; // ISO date
  splits?: StaggeredSplit[];
  requiresHumanReview: boolean;
  humanReviewReason?: string;
  summary: string;
  replyBody: string;
}

// ── Skill Execution (returned by each handler's execute()) ─────────────────────

export interface SkillExecutionResult {
  success: boolean;
  summary: string;
  agentReplyId?: string;
  linesUpdated: number;
  poStatusChanged: boolean;
  followUpBy?: string; // ISO date
  intent: SupplierIntent;
  confidence: number;
  requiresHumanReview: boolean;
  humanReviewReason?: string;
}

// ── Skill Handler interface ────────────────────────────────────────────────────

export type PrismaTransaction = Prisma.TransactionClient;

export interface SkillHandler {
  /** Analyze the supplier message and return structured data for execution. */
  analyze(
    ctx: SkillContext,
    message: string,
    skillPrompt: string,
  ): Promise<SkillAnalysisResult>;

  /** Execute DB mutations inside the provided transaction. */
  execute(
    ctx: SkillContext,
    analysis: SkillAnalysisResult,
    tx: PrismaTransaction,
  ): Promise<SkillExecutionResult>;
}
