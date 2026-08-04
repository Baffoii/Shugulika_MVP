import "server-only";

import type { ProviderFamily } from "@/lib/integrations/contracts";
import { ProviderError } from "@/lib/integrations/errors";

export type AdapterHealth = {
  provider: ProviderFamily;
  enabled: boolean;
  ready: boolean;
  detail: string;
};

export type EmailSendRequest = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  correlationId: string;
  idempotencyKey: string;
};

export type WhatsAppTemplateRequest = {
  toE164: string;
  templateName: string;
  languageCode: "en" | "sw";
  variables: Record<string, string>;
  correlationId: string;
  idempotencyKey: string;
};

export type PaymentCheckoutRequest = {
  paymentIntentId: string;
  amountMinor: number;
  currency: "TZS";
  organizationId: string;
  correlationId: string;
};

export type AccountingUpsertRequest = {
  eventType:
    | "accounting.customer.upsert.v1"
    | "accounting.invoice.upsert.v1"
    | "accounting.payment.upsert.v1";
  payload: Record<string, unknown>;
  correlationId: string;
  idempotencyKey: string;
};

export interface EmailAdapter {
  readonly provider: "email";
  health(): AdapterHealth;
  send(request: EmailSendRequest): Promise<{ providerMessageId: string }>;
}

export interface WhatsAppAdapter {
  readonly provider: "whatsapp";
  health(): AdapterHealth;
  sendTemplate(request: WhatsAppTemplateRequest): Promise<{ providerMessageId: string }>;
}

export interface PaymentsAdapter {
  readonly provider: "payments";
  health(): AdapterHealth;
  createHostedCheckout(
    request: PaymentCheckoutRequest,
  ): Promise<{ checkoutUrl: string; providerReference: string }>;
}

export interface AccountingAdapter {
  readonly provider: "accounting";
  health(): AdapterHealth;
  upsert(request: AccountingUpsertRequest): Promise<{ externalId: string }>;
}

function disabledHealth(provider: ProviderFamily, reason: string): AdapterHealth {
  return { provider, enabled: false, ready: false, detail: reason };
}

export class DisabledEmailAdapter implements EmailAdapter {
  readonly provider = "email" as const;
  health(): AdapterHealth {
    return disabledHealth("email", "Email adapter disabled until notification outbox lands.");
  }
  async send(_request: EmailSendRequest): Promise<{ providerMessageId: string }> {
    throw new ProviderError({
      code: "email_disabled",
      message: "Email adapter is disabled.",
      errorClass: "permanent",
    });
  }
}

export class DisabledWhatsAppAdapter implements WhatsAppAdapter {
  readonly provider = "whatsapp" as const;
  health(): AdapterHealth {
    return disabledHealth(
      "whatsapp",
      "Meta WhatsApp Cloud API disabled until templates and consent ops are ready.",
    );
  }
  async sendTemplate(_request: WhatsAppTemplateRequest): Promise<{ providerMessageId: string }> {
    throw new ProviderError({
      code: "whatsapp_disabled",
      message: "WhatsApp adapter is disabled.",
      errorClass: "permanent",
    });
  }
}

export class DisabledPaymentsAdapter implements PaymentsAdapter {
  readonly provider = "payments" as const;
  health(): AdapterHealth {
    return disabledHealth(
      "payments",
      "Flutterwave adapter disabled until sandbox verification completes.",
    );
  }
  async createHostedCheckout(
    _request: PaymentCheckoutRequest,
  ): Promise<{ checkoutUrl: string; providerReference: string }> {
    throw new ProviderError({
      code: "payments_disabled",
      message: "Payments adapter is disabled.",
      errorClass: "permanent",
    });
  }
}

export class DisabledAccountingAdapter implements AccountingAdapter {
  readonly provider = "accounting" as const;
  health(): AdapterHealth {
    return disabledHealth("accounting", "Zoho Books accounting adapter disabled by default.");
  }
  async upsert(_request: AccountingUpsertRequest): Promise<{ externalId: string }> {
    throw new ProviderError({
      code: "accounting_disabled",
      message: "Accounting adapter is disabled.",
      errorClass: "permanent",
    });
  }
}

/** Feature flags for provider families — fail closed unless explicitly true. */
export function isProviderEnabled(family: ProviderFamily): boolean {
  const map: Record<ProviderFamily, string | undefined> = {
    email: process.env.NOTIFICATION_EMAIL_ENABLED,
    whatsapp: process.env.META_WHATSAPP_ENABLED,
    payments: process.env.FLUTTERWAVE_ENABLED,
    accounting: process.env.ZOHO_BOOKS_ENABLED,
    recruitment: process.env.ZOHO_RECRUIT_ENABLED,
    assessment: process.env.CENTRAL_TEST_ENABLED,
  };
  return map[family]?.trim().toLowerCase() === "true";
}
