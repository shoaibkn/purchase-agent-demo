import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const SENDER_EMAIL = `Purchase Agent <testing@lumin8.in>`;

interface SendEmailParams {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  replyTo?: string;
}

export async function sendEmail({
  to,
  cc,
  subject,
  body,
  replyTo,
}: SendEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!resend) {
    console.warn("RESEND_API_KEY not configured - email not sent");
    return { success: false, error: "Resend not configured" };
  }

  try {
    const data = await resend.emails.send({
      from: SENDER_EMAIL,
      to,
      cc,
      replyTo: replyTo,
      subject,
      html: `<pre style="font-family: sans-serif; white-space: pre-wrap;">${body}</pre>`,
      text: body,
    });

    if (data.error) {
      console.error("Resend error:", data.error);
      return { success: false, error: data.error.message };
    }

    return { success: true, messageId: data.data?.id };
  } catch (error) {
    console.error("Failed to send email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export function parseSupplierReply(emailBody: string): {
  acknowledged: boolean;
  lineUpdates: Array<{ materialName?: string; proposedDate?: Date; quantity?: number; note?: string }>;
  rawText: string;
} {
  const acknowledged = emailBody.toLowerCase().includes("acknowledge") || 
                      emailBody.toLowerCase().includes("confirmed") ||
                      emailBody.toLowerCase().includes("noted");

  const datePattern = /(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{2,4})/g;
  const dates = emailBody.match(datePattern)?.map(d => new Date(d)) || [];
  
  const qtyPattern = /(\d+(?:\.\d+)?)\s*(?:units?|pcs?|kg|pcs)/gi;
  const quantities = [...emailBody.matchAll(qtyPattern)].map(m => parseFloat(m[1]));

  const lineUpdates = dates.slice(0, 3).map((date, i) => ({
    proposedDate: date,
    quantity: quantities[i],
    note: "Parsed from email",
  }));

  return {
    acknowledged,
    lineUpdates,
    rawText: emailBody,
  };
}
