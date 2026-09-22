// Thin wrapper around Wix's eCommerce "Search Orders" API, filtered to a
// single donation campaign.
//
// Docs referenced:
// - Search Orders: POST https://www.wixapis.com/ecom/v1/orders/search
//   https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/search-orders
// - Donation campaign <-> order link via lineItems.catalogReference:
//   https://dev.wix.com/docs/rest/business-solutions/donations/donation-campaigns/e-commerce-integration-with-donation-campaigns
// - API key auth headers:
//   https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/make-api-calls-with-an-api-key
//
// NOTE: Wix's docs were incomplete on the exact response JSON shape and the
// precise auth header names when this was written. The `Authorization` +
// `wix-site-id` header pattern below is Wix's standard site-level API key
// pattern — confirm it against your generated key's setup screen. Same for
// the response field paths (`buyerInfo.email`, `priceSummary.total.amount`,
// `createdDate`) — log one raw response the first time this runs and verify
// before trusting the parsed output.

const WIX_DONATIONS_APP_ID = "333b456e-dd48-4d6b-b32b-9fd48d74e163";

export type WixDonationOrder = {
  id: string;
  number: string;
  donorEmail: string;
  amountCents: number;
  createdAt: string; // ISO
};

export async function fetchWixDonationOrdersSince(
  createdAfterIso: string
): Promise<WixDonationOrder[]> {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  const campaignId = process.env.WIX_DONATION_CAMPAIGN_ID;

  if (!apiKey || !siteId || !campaignId) {
    throw new Error(
      "Missing WIX_API_KEY, WIX_SITE_ID, or WIX_DONATION_CAMPAIGN_ID env vars"
    );
  }

  const orders: WixDonationOrder[] = [];
  let cursor: string | undefined;

  do {
    const res = await fetch("https://www.wixapis.com/ecom/v1/orders/search", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "wix-site-id": siteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        search: {
          filter: {
            createdDate: { $gte: createdAfterIso },
            "lineItems.catalogReference.appId": { $eq: WIX_DONATIONS_APP_ID },
            "lineItems.catalogReference.catalogItemId": { $eq: campaignId },
            status: { $ne: "CANCELED" },
          },
          sort: [{ fieldName: "createdDate", order: "ASC" }],
          cursorPaging: { limit: 100, cursor },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Wix Search Orders failed: ${res.status} ${await res.text()}`
      );
    }

    const data = await res.json();

    for (const order of data.orders ?? []) {
      orders.push({
        id: order.id,
        number: order.number,
        donorEmail: order.buyerInfo?.email ?? "",
        amountCents: Math.round(
          parseFloat(order.priceSummary?.total?.amount ?? "0") * 100
        ),
        createdAt: order.createdDate,
      });
    }

    cursor = data.metadata?.cursors?.next;
  } while (cursor);

  return orders;
}
