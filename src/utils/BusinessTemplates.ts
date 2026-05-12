export interface BusinessTemplate {
  id: string;
  name: string;
  category: string;
  searchPrompt: string;
  suggestedSites: string[];
  extractionSchema: Record<string, string>;
  searchKeywords: string[];
}

export const businessTemplates: Record<string, BusinessTemplate> = {
  comic_books: {
    id: 'comic_books',
    name: 'Comic Books',
    category: 'Collectibles',
    searchPrompt: 'Extract comic book details: title, issue number, variant cover, condition/grade, publisher, publication year, key characters, creators, story arcs, and market value',
    suggestedSites: [
      'metropoliscomics.com',
      'mycomicshop.com',
      'comicconnect.com',
      'heritage-auctions.com',
      'covrprice.com'
    ],
    extractionSchema: {
      title: 'Comic book title and series name',
      issue_number: 'Issue number and variant details',
      condition: 'Condition grade (CGC, CBCS, raw)',
      publisher: 'Publisher name (Marvel, DC, etc.)',
      year: 'Publication year',
      characters: 'Key characters featured',
      creators: 'Writer, artist, cover artist',
      key_issues: 'First appearances, deaths, major events'
    },
    searchKeywords: ['comic', 'issue', 'variant', 'cgc', 'cbcs', 'marvel', 'dc']
  },

  general_products: {
    id: 'general_products',
    name: 'General Products',
    category: 'General',
    searchPrompt: 'Extract comprehensive product details: title, brand, model, price, description, specifications, dimensions, weight, materials, features, and condition',
    suggestedSites: [
      'amazon.com',
      'ebay.com',
      'walmart.com',
      'target.com',
      'bestbuy.com'
    ],
    extractionSchema: {
      title: 'Product name and model',
      brand: 'Manufacturer or brand name',
      price: 'Current market price',
      description: 'Detailed product description',
      specifications: 'Technical specifications',
      condition: 'Product condition (new, used, refurbished)',
      features: 'Key features and benefits',
      dimensions: 'Size and weight information'
    },
    searchKeywords: ['product', 'brand', 'model', 'specifications', 'features']
  },

  collectibles: {
    id: 'collectibles',
    name: 'Collectibles & Antiques',
    category: 'Collectibles',
    searchPrompt: 'Extract collectible details: item name, brand/manufacturer, series, condition, rarity, year/era, provenance, estimated value, and authentication details',
    suggestedSites: [
      'worthpoint.com',
      'liveauctioneers.com',
      'heritage-auctions.com',
      'proxibid.com',
      'collectors.com'
    ],
    extractionSchema: {
      item_name: 'Collectible item name',
      manufacturer: 'Brand or manufacturer',
      series: 'Series or collection name',
      condition: 'Condition assessment',
      rarity: 'Rarity level or scarcity',
      era: 'Time period or year manufactured',
      value: 'Current market value estimate'
    },
    searchKeywords: ['collectible', 'vintage', 'rare', 'antique', 'limited edition']
  },

  trading_cards: {
    id: 'trading_cards',
    name: 'Trading Cards',
    category: 'Collectibles',
    searchPrompt: 'Extract trading card details: player/character name, card number, set name, year, condition/grade, rookie status, parallel/insert type, and current market value',
    suggestedSites: [
      'cardmarket.com',
      'tcgplayer.com',
      'comc.com',
      'psacard.com',
      'beckett.com'
    ],
    extractionSchema: {
      player_name: 'Player or character name',
      card_number: 'Card number within set',
      set_name: 'Set or series name',
      year: 'Year of release',
      condition: 'Grade or condition (PSA, BGS, raw)',
      card_type: 'Base, rookie, insert, parallel, autograph',
      sport: 'Sport or game type'
    },
    searchKeywords: ['card', 'rookie', 'psa', 'bgs', 'autograph', 'parallel', 'insert']
  },

  electronics: {
    id: 'electronics',
    name: 'Electronics',
    category: 'Technology',
    searchPrompt: 'Extract electronics details: product name, brand, model number, specifications, compatibility, condition, warranty status, accessories included, and current market price',
    suggestedSites: [
      'bestbuy.com',
      'newegg.com',
      'amazon.com',
      'bhphotovideo.com',
      'adorama.com'
    ],
    extractionSchema: {
      product_name: 'Device name and model',
      brand: 'Manufacturer brand',
      model_number: 'Specific model number',
      specifications: 'Technical specifications',
      compatibility: 'Compatible systems/devices',
      condition: 'Working condition and cosmetic state',
      accessories: 'Included accessories and cables'
    },
    searchKeywords: ['electronics', 'tech', 'device', 'model', 'specifications', 'warranty']
  }
};

export function getBusinessTemplate(templateId: string): BusinessTemplate | null {
  return businessTemplates[templateId] || null;
}

export function getTemplateByCategory(category: string): BusinessTemplate[] {
  return Object.values(businessTemplates).filter(template => 
    template.category.toLowerCase() === category.toLowerCase()
  );
}

export function detectTemplateFromQuery(query: string): BusinessTemplate | null {
  const lowerQuery = query.toLowerCase();
  
  for (const template of Object.values(businessTemplates)) {
    const hasKeyword = template.searchKeywords.some(keyword => 
      lowerQuery.includes(keyword.toLowerCase())
    );
    
    if (hasKeyword) {
      return template;
    }
  }
  
  // Default to general products if no specific template detected
  return businessTemplates.general_products;
}

export function getAllTemplates(): BusinessTemplate[] {
  return Object.values(businessTemplates);
} 