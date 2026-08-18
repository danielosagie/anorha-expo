// Static copy mirrors backend src/platform-connections/platform-disclosures.ts.
// It is plain data so the consent body can reuse it without carrying a second,
// unused modal implementation.
export type PlatformDisclosure = {
  title: string;
  subtitle: string;
  bullets: string[];
  apiKey?: boolean;
};

export const DISCLOSURES: Record<string, PlatformDisclosure> = {
  shopify: {
    title: 'Connect Shopify store',
    subtitle: 'Keep your products, inventory and orders in sync with your Shopify store',
    bullets: [
      'Sync products, inventory levels and orders between Anorha and your Shopify store',
      'Anorha will read and update your Shopify catalog, inventory and order information on your behalf',
      'Disconnect at any time from your Anorha settings or your Shopify account',
    ],
  },
  square: {
    title: 'Connect Square account',
    subtitle: 'Keep your catalog, inventory and orders in sync with Square',
    bullets: [
      'Sync catalog items, inventory counts and orders between Anorha and Square',
      'Anorha will read and update your Square catalog, inventory and orders across your locations',
      'Disconnect at any time from your Anorha settings or your Square account',
    ],
  },
  clover: {
    title: 'Connect Clover merchant',
    subtitle: 'Keep your items, stock and orders in sync with your Clover merchant',
    bullets: [
      'Sync items, stock levels and orders between Anorha and your Clover merchant',
      'Anorha will read and update your Clover inventory and receive order updates for your merchant',
      'Disconnect at any time from your Anorha settings or your Clover account',
    ],
  },
  ebay: {
    title: 'Connect eBay account',
    subtitle: 'Keep your listings, inventory and orders in sync with eBay',
    bullets: [
      'Sync listings, offers, inventory and orders between Anorha and your eBay account',
      'Anorha will read and update your eBay inventory and listings and receive order notifications',
      'Disconnect at any time from your Anorha settings or your eBay account',
    ],
  },
  facebook: {
    title: 'Connect Facebook account',
    subtitle: 'List and sync your products on Facebook Marketplace and catalogs',
    bullets: [
      'Reading keeps your Facebook listings and availability in sync with your other channels',
      'Posting happens through your own computer and Facebook account, paced to keep your account safe; your computer needs to be on',
      'Disconnect at any time from your Anorha settings or your Facebook account',
    ],
  },
  whatnot: {
    title: 'Connect Whatnot account',
    subtitle: 'Keep your Whatnot listings and inventory in sync with your other sales channels',
    bullets: [
      'Sync products, listings, quantities and orders between Anorha and your Whatnot shop',
      'Anorha will read and update your Whatnot inventory and read your orders through the Whatnot Seller API',
      'Disconnect at any time from your Anorha settings or your Whatnot account',
    ],
  },
  depop: {
    title: 'Connect Depop shop',
    subtitle: 'Keep your Depop listings and inventory in sync with your other sales channels',
    bullets: [
      'Sync listings, quantities and orders between Anorha and your Depop shop',
      'Anorha will create, update and delete listings in your Depop shop and read your orders using your Depop API key',
      'Disconnect at any time from your Anorha settings or your Depop account',
    ],
    apiKey: true,
  },
};
