import { createPolar, webhooks } from "@polar-sh/sdk/2026-10";
import type { Billing } from "../deps";

export function createPolarBilling(opts: {
  accessToken: string;
  webhookSecret: string;
  productId: string;
  environment: "sandbox" | "production";
}): Billing {
  const polar = createPolar({ accessToken: opts.accessToken, environment: opts.environment });
  return {
    async createCheckout(input) {
      const checkout = await polar.checkouts.create({
        products: [opts.productId],
        external_customer_id: input.userId,
        customer_email: input.email,
        success_url: input.successUrl,
        return_url: input.returnUrl,
        // Copied onto the subscription, so webhooks know which repo was paid for.
        metadata: { repositoryId: input.repositoryId, installationId: input.installationId, userId: input.userId },
      });
      return { url: checkout.url };
    },
    async createPortalSession(input) {
      const session = await polar.customerSessions.create({ external_customer_id: input.userId, return_url: input.returnUrl });
      return { url: session.customer_portal_url };
    },
    async verifyWebhook(rawBody, headers) {
      const event = await webhooks.validateEvent(
        rawBody,
        {
          "webhook-id": headers["webhook-id"] ?? "",
          "webhook-timestamp": headers["webhook-timestamp"] ?? "",
          "webhook-signature": headers["webhook-signature"] ?? "",
        },
        opts.webhookSecret,
      );
      return { type: event.type, data: event.data };
    },
  };
}
