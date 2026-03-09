"use client";

import { useState, useEffect, useCallback } from "react";
import { format, formatDistanceToNow } from "date-fns";
import Link from "next/link";

type SenderType = "PURCHASER" | "AGENT" | "SUPPLIER";
type MessageDirection = "INBOUND" | "OUTBOUND";

interface Supplier {
  id: string;
  name: string;
  primaryEmail: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
}

interface Message {
  id: string;
  direction: MessageDirection;
  senderType: SenderType | null;
  fromEmail: string;
  toEmails: string[];
  subject: string;
  body: string;
  intent: string | null;
  createdAt: string;
}

interface Thread {
  id: string;
  subject: string;
  supplier: Supplier;
  purchaseOrder: PurchaseOrder;
  messages: Message[];
}

interface ThreadListItem {
  id: string;
  subject: string;
  supplier: Supplier;
  purchaseOrder: PurchaseOrder;
  latestMessage: Message | null;
  updatedAt: string;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface AgentProcessingResult {
  success: boolean;
  summary: string;
  linesUpdated: number;
  poStatusChanged: boolean;
  followUpBy?: string;
}

const senderTypeLabels: Record<SenderType, string> = {
  PURCHASER: "Purchaser",
  AGENT: "Agent",
  SUPPLIER: "Supplier",
};

const senderTypeColors: Record<SenderType, string> = {
  PURCHASER: "bg-blue-100 text-blue-800",
  AGENT: "bg-purple-100 text-purple-800",
  SUPPLIER: "bg-emerald-100 text-emerald-800",
};

const senderTypeBorderColors: Record<SenderType, string> = {
  PURCHASER: "border-blue-300",
  AGENT: "border-purple-300",
  SUPPLIER: "border-emerald-300",
};

const senderTypeButtonActive: Record<SenderType, string> = {
  PURCHASER: "bg-blue-600 text-white",
  AGENT: "bg-purple-600 text-white",
  SUPPLIER: "bg-emerald-600 text-white",
};

const senderTypeButtonInactive: Record<SenderType, string> = {
  PURCHASER: "bg-blue-50 text-blue-700 hover:bg-blue-100",
  AGENT: "bg-purple-50 text-purple-700 hover:bg-purple-100",
  SUPPLIER: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
};

const sendButtonColors: Record<SenderType, string> = {
  PURCHASER: "bg-blue-600 hover:bg-blue-700",
  AGENT: "bg-purple-600 hover:bg-purple-700",
  SUPPLIER: "bg-emerald-600 hover:bg-emerald-700",
};

const sendButtonLabels: Record<SenderType, string> = {
  PURCHASER: "Send",
  AGENT: "Send as Agent",
  SUPPLIER: "Send as Supplier",
};

function getSenderType(message: Message): SenderType {
  if (message.senderType) return message.senderType;
  if (message.direction === "INBOUND") return "SUPPLIER";
  if (message.intent === "ack_reminder_24h" || message.intent === "edd_overdue_followup") return "AGENT";
  return "PURCHASER";
}

export default function CommunicationsPage() {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);

  const [filters, setFilters] = useState({
    search: "",
    supplierId: "",
    direction: "",
    senderType: "",
    dateRange: "all",
  });

  const [replyBody, setReplyBody] = useState("");
  const [composeSenderType, setComposeSenderType] = useState<SenderType>("PURCHASER");
  const [agentResult, setAgentResult] = useState<AgentProcessingResult | null>(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.supplierId) params.set("supplierId", filters.supplierId);
      if (filters.direction) params.set("direction", filters.direction);
      if (filters.senderType) params.set("senderType", filters.senderType);
      if (filters.dateRange !== "all") params.set("dateRange", filters.dateRange);

      const res = await fetch(`/api/email-threads?${params.toString()}`);
      const data = await res.json();
      setThreads(data.data || []);
    } catch (error) {
      console.error("Failed to fetch threads:", error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    try {
      const res = await fetch(`/api/email-threads/${id}`);
      const data = await res.json();
      setSelectedThread(data.data);
    } catch (error) {
      console.error("Failed to fetch thread:", error);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers");
      const data = await res.json();
      setSuppliers(data.data || []);
    } catch (error) {
      console.error("Failed to fetch suppliers:", error);
    }
  }, []);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    if (selectedThreadId) {
      fetchThread(selectedThreadId);
    }
  }, [selectedThreadId, fetchThread]);

  const handleSendReply = async () => {
    if (!selectedThreadId || !replyBody.trim()) return;

    setSendingReply(true);
    setAgentResult(null);
    try {
      const res = await fetch(`/api/email-threads/${selectedThreadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: replyBody,
          senderType: composeSenderType,
        }),
      });

      if (res.ok) {
        const payload = await res.json();
        setReplyBody("");

        // Show agent processing result if supplier message was sent
        if (composeSenderType === "SUPPLIER" && payload.agentProcessing) {
          setAgentResult(payload.agentProcessing);
        }

        fetchThread(selectedThreadId);
        fetchThreads();
      }
    } catch (error) {
      console.error("Failed to send reply:", error);
    } finally {
      setSendingReply(false);
    }
  };

  const handleGenerateDraft = async () => {
    if (!selectedThreadId) return;

    setGeneratingDraft(true);
    try {
      const res = await fetch(`/api/email-threads/${selectedThreadId}/generate-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (res.ok) {
        const payload = await res.json();
        if (payload.draft) {
          setReplyBody(payload.draft);
        }
      }
    } catch (error) {
      console.error("Failed to generate draft:", error);
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const dismissAgentResult = () => setAgentResult(null);

  return (
    <section className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Communications</h1>
        <p className="text-sm text-[color:var(--muted)]">
          Email client for all purchase order communications with suppliers. Send as Purchaser, Supplier, or Agent.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search emails..."
          value={filters.search}
          onChange={(e) => handleFilterChange("search", e.target.value)}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
        />

        <select
          value={filters.supplierId}
          onChange={(e) => handleFilterChange("supplierId", e.target.value)}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          value={filters.direction}
          onChange={(e) => handleFilterChange("direction", e.target.value)}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="">All Directions</option>
          <option value="INBOUND">Inbound</option>
          <option value="OUTBOUND">Outbound</option>
        </select>

        <select
          value={filters.senderType}
          onChange={(e) => handleFilterChange("senderType", e.target.value)}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="">All Senders</option>
          <option value="PURCHASER">Purchaser</option>
          <option value="AGENT">Agent</option>
          <option value="SUPPLIER">Supplier</option>
        </select>

        <select
          value={filters.dateRange}
          onChange={(e) => handleFilterChange("dateRange", e.target.value)}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="w-1/3 overflow-y-auto rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)]">
          <div className="divide-y divide-[color:var(--card-border)]">
            {loading ? (
              <div className="p-4 text-center text-sm text-[color:var(--muted)]">Loading...</div>
            ) : threads.length === 0 ? (
              <div className="p-4 text-center text-sm text-[color:var(--muted)]">No threads found</div>
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => setSelectedThreadId(thread.id)}
                  className={`w-full p-4 text-left transition-colors hover:bg-[color:var(--muted)]/5 ${
                    selectedThreadId === thread.id ? "bg-[color:var(--accent)]/10" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[color:var(--muted)]">
                      {thread.purchaseOrder?.poNumber || "No PO"}
                    </span>
                    <span className="text-xs text-[color:var(--muted)]">
                      {thread.latestMessage && formatDistanceToNow(new Date(thread.latestMessage.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">{thread.subject}</p>
                  <div className="mt-1 flex items-center gap-2">
                    {thread.latestMessage && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${senderTypeColors[getSenderType(thread.latestMessage)]}`}>
                        {senderTypeLabels[getSenderType(thread.latestMessage)]}
                      </span>
                    )}
                    <span className="text-xs text-[color:var(--muted)]">{thread.supplier.name}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)]">
          {!selectedThreadId ? (
            <div className="flex h-full items-center justify-center text-[color:var(--muted)]">
              Select a thread to view messages
            </div>
          ) : loadingThread ? (
            <div className="flex h-full items-center justify-center text-[color:var(--muted)]">
              Loading thread...
            </div>
          ) : selectedThread ? (
            <div className="flex h-full flex-col">
              <div className="border-b border-[color:var(--card-border)] p-4">
                <h2 className="text-lg font-semibold">{selectedThread.subject}</h2>
                <div className="mt-1 flex items-center gap-2 text-sm text-[color:var(--muted)]">
                  <span>{selectedThread.supplier.name}</span>
                  <span>&bull;</span>
                  <Link
                    href={`/purchase-orders/${selectedThread.purchaseOrder?.poNumber}`}
                    className="text-[color:var(--accent)] hover:underline"
                  >
                    {selectedThread.purchaseOrder?.poNumber}
                  </Link>
                  <span>&bull;</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-800">
                    {selectedThread.purchaseOrder?.status}
                  </span>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {selectedThread.messages.map((message) => {
                  const sender = getSenderType(message);
                  const isOutbound = message.direction === "OUTBOUND";

                  return (
                    <div
                      key={message.id}
                      className={`rounded-xl p-4 ${isOutbound ? "bg-slate-50" : "bg-white"} border border-[color:var(--card-border)]`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${senderTypeColors[sender]}`}>
                            {senderTypeLabels[sender]}
                          </span>
                          <span className="text-sm text-[color:var(--muted)]">{message.fromEmail}</span>
                        </div>
                        <span className="text-xs text-[color:var(--muted)]">
                          {format(new Date(message.createdAt), "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{message.body}</div>
                    </div>
                  );
                })}
              </div>

              {/* ── Agent Processing Result Banner ── */}
              {agentResult && (
                <div
                  className={`mx-4 mb-2 flex items-start justify-between rounded-lg border p-3 text-sm ${
                    agentResult.success
                      ? "border-purple-200 bg-purple-50 text-purple-900"
                      : "border-rose-200 bg-rose-50 text-rose-900"
                  }`}
                >
                  <div>
                    <p className="font-semibold">
                      {agentResult.success ? "Agent processed supplier message" : "Agent processing failed"}
                    </p>
                    <p className="mt-0.5 text-xs">{agentResult.summary}</p>
                    {agentResult.linesUpdated > 0 && (
                      <p className="mt-0.5 text-xs">
                        {agentResult.linesUpdated} line(s) updated.
                        {agentResult.poStatusChanged && " PO status changed to ACKNOWLEDGED."}
                      </p>
                    )}
                    {agentResult.followUpBy && (
                      <p className="mt-0.5 text-xs">
                        Follow-up reminder scheduled for{" "}
                        {new Date(agentResult.followUpBy).toLocaleDateString("en-IN", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                        .
                      </p>
                    )}
                  </div>
                  <button
                    onClick={dismissAgentResult}
                    className="ml-3 shrink-0 text-xs underline opacity-70 hover:opacity-100"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* ── Compose Area ── */}
              <div className={`border-t p-4 ${senderTypeBorderColors[composeSenderType]}`}>
                {/* Sender type selector */}
                <div className="mb-3 flex items-center gap-1.5">
                  <span className="mr-1 text-xs font-medium text-[color:var(--muted)]">Send as:</span>
                  {(["PURCHASER", "AGENT", "SUPPLIER"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setComposeSenderType(type)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        composeSenderType === type
                          ? senderTypeButtonActive[type]
                          : senderTypeButtonInactive[type]
                      }`}
                    >
                      {senderTypeLabels[type]}
                    </button>
                  ))}
                </div>

                {/* Contextual hint */}
                <div className="mb-2 text-[11px] text-[color:var(--muted)]">
                  {composeSenderType === "PURCHASER" && (
                    <span>Sending as the buyer. Message is recorded as an outbound email.</span>
                  )}
                  {composeSenderType === "AGENT" && (
                    <span>Sending as the AI agent. Use &quot;Generate Draft&quot; for an AI-written email, then review and send.</span>
                  )}
                  {composeSenderType === "SUPPLIER" && (
                    <span>Simulating a supplier reply. The agent will automatically analyze this message and update PO lines.</span>
                  )}
                </div>

                <div className="flex gap-2">
                  <div className="flex flex-1 flex-col gap-2">
                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      placeholder={
                        composeSenderType === "SUPPLIER"
                          ? "Write as the supplier... (e.g. 'Acknowledged. We can deliver 500 kg of Cold Rolled Steel Coil by 2026-03-25.')"
                          : composeSenderType === "AGENT"
                            ? "Click 'Generate Draft' or write manually..."
                            : "Write a reply..."
                      }
                      rows={3}
                      className={`w-full rounded-lg border bg-white px-3 py-2 text-sm resize-none ${senderTypeBorderColors[composeSenderType]}`}
                    />

                    {/* Generate Draft button for Agent mode */}
                    {composeSenderType === "AGENT" && (
                      <button
                        onClick={handleGenerateDraft}
                        disabled={generatingDraft}
                        className="self-start rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {generatingDraft ? "Generating draft..." : "Generate Draft"}
                      </button>
                    )}
                  </div>

                  <button
                    onClick={handleSendReply}
                    disabled={!replyBody.trim() || sendingReply}
                    className={`self-start rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sendButtonColors[composeSenderType]}`}
                  >
                    {sendingReply
                      ? composeSenderType === "SUPPLIER"
                        ? "Sending & processing..."
                        : "Sending..."
                      : sendButtonLabels[composeSenderType]}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[color:var(--muted)]">
              Thread not found
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
