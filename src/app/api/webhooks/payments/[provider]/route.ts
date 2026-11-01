import { jsonData, routeWithParams } from "@/lib/http";
import { handlePaymentWebhook } from "@/modules/payments/service";

// Gateway payment events (Tech §6, §8). The signature covers the raw body, so
// it is read as text. 200 once the event is recorded and processed, including
// duplicates and unknown references, so the gateway stops retrying.
export const POST = routeWithParams<{ provider: string }>(
  async (request, { params }) => {
    const { provider } = await params;
    const rawBody = await request.text();
    const { outcome } = await handlePaymentWebhook(
      provider,
      rawBody,
      request.headers,
    );
    return jsonData({ outcome });
  },
);
