const SHOPIFY_HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const validHandle = (value: string): string | null => {
  const handle = value.trim().toLowerCase();
  return SHOPIFY_HANDLE.test(handle) ? handle : null;
};

/**
 * Resolves the stable Shopify store handle from every shape merchants commonly
 * see or paste. Custom storefront domains are intentionally not accepted since
 * Shopify Admin OAuth requires the permanent myshopify.com identity.
 */
export const extractShopifyStoreHandle = (
  value?: string | null,
): string | null => {
  if (!value) return null;

  const input = value.trim();
  if (!input) return null;

  const adminMatch = input.match(
    /(?:https?:\/\/)?admin\.shopify\.com\/store\/([^/?#\s]+)/i,
  );
  if (adminMatch?.[1]) return validHandle(adminMatch[1]);

  const myshopifyMatch = input.match(
    /(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)\.myshopify\.com(?:[/?#\s]|$)/i,
  );
  if (myshopifyMatch?.[1]) return validHandle(myshopifyMatch[1]);

  return validHandle(input.replace(/^\/+|\/+$/g, ""));
};
