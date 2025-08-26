import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export type PlatformsData = Record<string, any>;
export type RequirementMap = Record<string, string[]>;

export interface GenerateJobData {
  type: 'generate-job';
  jobId: string;
  userId: string;
  products: Array<{
    productIndex: number;
    productId?: string;
    variantId?: string;
    imageUrls: string[];
    coverImageIndex: number;
    selectedMatches?: Array<any>; // SerpAPI selections or structured picks
  }>;
  selectedPlatforms: string[]; // e.g., ['shopify', 'amazon']
  template?: string | null;
  // Optional: fine-grained per-platform field source guidance from the template modal
  platformRequests?: Array<{
    platform: string;
    fieldSources?: Record<string, string[]>; // field -> preferred source domains/urls in order
    customPrompt?: string;
    requestedFields?: string[]; // additive hard-fail set: only generate these fields
  }>;
  // Optional: top-level sources list from the template (domains/urls)
  templateSources?: string[];
  options?: {
    useScraping?: boolean; // whether to scrape sources before generation
  };
  metadata: {
    totalProducts: number;
    estimatedTimeMinutes: number;
    createdAt: string;
  };
}

export interface GeneratedPlatformSpecificDetails {
  title?: string;
  description?: string;
  price?: number;
  compareAtPrice?: number;
  categorySuggestion?: string;
  tags?: string[] | string;
  brand?: string;
  condition?: string;
  // Platform-specific, open-ended structure allowed
  [key: string]: any;
}

export interface GenerateJobResult {
  productIndex: number;
  productId?: string;
  variantId?: string;
  platforms: Record<string, GeneratedPlatformSpecificDetails>;
  sourceImageUrl: string;
  processingTimeMs: number;
  source?: 'ai_generated' | 'scraped_content' | 'hybrid';
  sources?: Array<{ url: string; usedForFields?: string[] }>;
  error?: string;
}

export interface GenerateJobStatus {
  jobId: string;
  userId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  currentStage:
    | 'Preparing'
    | 'Fetching sources'
    | 'Scraping sources'
    | 'Generating details'
    | 'Saving drafts'
    | 'Ready';
  progress: {
    totalProducts: number;
    completedProducts: number;
    currentProductIndex?: number;
    failedProducts: number;
    stagePercentage: number;
  };
  results: GenerateJobResult[];
  summary?: {
    totalProducts: number;
    completed: number;
    failed: number;
    averageProcessingTimeMs?: number;
  };
  error?: string;
  startedAt: string;
  completedAt?: string;
  estimatedCompletionAt?: string;
  updatedAt: string;
}



// ===================================================================
// Shopify Interface
// ===================================================================

export interface ShopifyImage {
  productImageURL: string;
  imagePosition: number;
  imageAltText: string;
}

export interface ShopifyVariant {
  option1_name: string;
  option1_value: string;
  option2_name: string;
  option2_value: string;
  option3_name: string;
  option3_value: string;
  sku: string;
  barcode: string;
  price: number;
  compareAtPrice: number;
  costPerItem: number;
  chargeTax: boolean;
  taxCode: string;
  inventoryTracker: string;
  inventoryQuantity: number;
  continueSellingWhenOutOfStock: boolean;
  weightValueGrams: number;
  requiresShipping: boolean;
  fulfillmentService: string;
  variantImageURL: string;
}

export interface ShopifySeo {
  seoTitle: string;
  seoDescription: string;
}

export interface ShopifyGoogleShopping {
  googleProductCategory: string;
  gender: string;
  ageGroup: string;
  mpn: string;
  adWordsGrouping: string;
  adWordsLabels: string;
  condition: string;
  customProduct: boolean;
  customLabel0: string;
  customLabel1: string;
  customLabel2: string;
  customLabel3: string;
  customLabel4: string;
}

export interface Shopify {
  title: string;
  description: string;
  vendor: string;
  productCategory: string;
  productType: string;
  tags: string[];
  status: 'active' | 'draft' | 'archived';
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  publishedOnOnlineStore: boolean;
  giftCard: boolean;
  seo: ShopifySeo;
  googleShopping: ShopifyGoogleShopping;
}


// ===================================================================
// Amazon Interface
// ===================================================================

export interface Amazon {
  sku: string;
  productId: string;
  productIdType: 'UPC' | 'EAN' | 'GTIN' | 'ASIN' | 'ISBN';
  title: string;
  brand: string;
  manufacturer: string;
  description: string;
  bullet_points: string[];
  search_terms: string[];
  price: number;
  quantity: number;
  mainImageURL: string;
  otherImageURLs: string[];
  categorySuggestion: string;
  amazonProductType: string; // e.g., "BOOKS"
  condition: 'New' | 'Used' | 'Refurbished';
}


// ===================================================================
// eBay Interface
// ===================================================================

export interface EbayConditionDetails {
  professionalGrader: string;
  grade: string;
  certificationNumber: string;
  cardCondition: string;
}

export interface EbayItemSpecifics {
  set?: string;
  franchise?: string;
  manufacturer?: string;
  configuration?: string;
  numberOfCards?: number;
  numberOfCases?: number;
  type?: string;
  yearManufactured?: number;
  character?: string;
  tvShow?: string;
  movie?: string;
  language?: string;
  ageLevel?: string;
  autographAuthentication?: string;
  genre?: string;
  countryRegionOfManufacture?: string;
  features?: string[];
  vintage?: boolean;
  material?: string;
  autographed?: boolean;
  cardSize?: string;
  mpn?: string;
  signedBy?: string;
  autographAuthenticationNumber?: string;
  autographFormat?: string;
  californiaProp65Warning?: string;
  conventionEvent?: string;
  featuredPersonArtist?: string;
  illustrator?: string;
  grade?: number;
  numberOfPacks?: number;
  brand?: string;
  size?: string;
  style?: string;
  sizeType?: string;
  color?: string;
  department?: string;
  fabricWash?: string;
  accents?: string;
  pattern?: string;
  fit?: string;
  rise?: string;
  fabricType?: string;
  inseam?: string;
  waistSize?: string;
  closure?: string;
  theme?: string;
  model?: string;
  productLine?: string;
  handmade?: boolean;
  personalize?: boolean;
  season?: string;
  garmentCare?: string;
  pocketType?: string;
  personalizationInstructions?: string;
  unitQuantity?: number;
  unitType?: string;
  parallelVariety?: string;
  cardNumber?: string;
  cardName?: string;
  graded?: boolean;
  originalLicensedReprint?: string;
  cardThickness?: string;
  insertSet?: string;
  printRun?: string;
  format?: string;
  focusType?: string;
  series?: string;
  manufacturerWarranty?: string;
  itemWeight?: string;
  itemHeight?: string;
  itemLength?: string;
  itemWidth?: string;
}

export interface EbayMedia {
  picURL: string;
  galleryType: string;
  videoID: string;
}

export interface EbayListingDetails {
  format: 'FixedPrice' | 'Auction';
  duration: string; // "GTC" for Good 'Til Canceled
  startPrice: number;
  buyItNowPrice?: number;
  bestOfferEnabled: boolean;
  bestOfferAutoAcceptPrice?: number;
  minimumBestOfferPrice?: number;
  quantity: number;
  immediatePayRequired: boolean;
  location: string;
}

export interface EbayShippingService {
  option: string;
  cost: number;
}

export interface EbayShippingDetails {
  shippingType: string;
  dispatchTimeMax: number;
  promotionalShippingDiscount: boolean;
  shippingDiscountProfileID: string;
  services: EbayShippingService[];
}

export interface EbayReturnPolicy {
  returnsAcceptedOption: string;
  returnsWithinOption: string;
  refundOption: string;
  shippingCostPaidByOption: string;
  additionalDetails: string;
}

export interface EbayProductSafety {
  productSafetyPictograms: string;
  productSafetyStatements: string;
  productSafetyComponent: string;
  regulatoryDocumentIds: string;
}

export interface EbayContactDetails {
  name?: string; // Added for clarity
  addressLine1: string;
  addressLine2: string;
  city: string;
  country: string;
  postalCode: string;
  stateOrProvince: string;
  phone: string;
  email: string;
  contactURL: string;
}

export interface EbayResponsiblePerson extends EbayContactDetails {
  type: string;
}

export interface Ebay {
  action: 'Add' | 'Revise' | 'End' | 'Verify';
  customLabel: string;
  category: string;
  storeCategory: string;
  title: string;
  subtitle: string;
  relationship: string;
  relationshipDetails: string;
  scheduleTime: string; // ISO 8601 format
  conditionID: number;
  conditionDetails: EbayConditionDetails;
  itemSpecifics: EbayItemSpecifics;
  media: EbayMedia;
  description: string;
  listingDetails: EbayListingDetails;
  shippingDetails: EbayShippingDetails;
  returnPolicy: EbayReturnPolicy;
  productSafety: EbayProductSafety;
  manufacturerDetails: EbayContactDetails;
  responsiblePerson: EbayResponsiblePerson;
}


// ===================================================================
// Whatnot Interface
// ===================================================================

export interface Whatnot {
  category: string;
  subCategory: string;
  title: string;
  description: string;
  quantity: number;
  type: 'Buy it Now' | 'Auction';
  price: number;
  shippingProfile: string;
  offerable: boolean;
  hazmat: 'Not Hazmat' | 'Hazmat';
  condition: string;
  costPerItem: number;
  sku: string;
  imageUrls: string[];
}


// ===================================================================
// Square Interface
// ===================================================================

export interface SquarePriceMoney {
  amount: number; // In cents
  currency: 'USD' | string;
}

export interface SquareItemVariationData {
  sku: string;
  name: string;
  pricingType: 'FIXED_PRICING' | 'VARIABLE_PRICING';
  priceMoney: SquarePriceMoney;
}

export interface SquareVariation {
  type: 'ITEM_VARIATION';
  id: string; // Placeholder like "#" or actual ID
  itemVariationData: SquareItemVariationData;
}

export interface SquareItemData {
  name: string;
  description: string;
  categorySuggestion: string;
  gtin: string | null;
  variations: SquareVariation[];
  locations: string; // e.g., "All Available Locations"
}

export interface Square {
  object: {
    type: 'ITEM';
    id: string; // Placeholder like "#" or actual ID
    itemData: SquareItemData;
  };
}


// ===================================================================
// Facebook Interface
// ===================================================================

export interface Facebook {
  id: string; // Corresponds to SKU
  title: string;
  description: string;
  availability: 'in stock' | 'out of stock' | 'available for order';
  condition: 'new' | 'refurbished' | 'used';
  price: string; // e.g., "9.99 USD"
  link: string; // Link to the product on your own website
  image_link: string;
  brand: string;
  google_product_category: string;
  categorySuggestion: string;
}


// ===================================================================
// Clover Interface
// ===================================================================

export interface CloverCategory {
  name: string;
}

export interface Clover {
  name: string;
  price: number;
  priceType: 'FIXED' | 'VARIABLE';
  sku: string;
  category: CloverCategory;
  modifierGroups: any[]; // Use `any` for maximum flexibility or define a specific ModifierGroup interface
  availability: 'in stock' | 'out of stock';
  brand: string;
}



type Props = {
  mode?: 'product' | 'generate';
  data: PlatformsData; // e.g. { shopify: {...}, ebay: {...} }
  initialTab?: string;
  title?: string;
  onOpenFieldPanel?: (fieldKey: string) => void;
};

const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  shopify: { label: 'Shopify', icon: 'shopping' },
  amazon: { label: 'Amazon', icon: 'amazon' },
  ebay: { label: 'eBay', icon: 'shopping' },
  clover: { label: 'Clover', icon: 'leaf' },
  square: { label: 'Square', icon: 'square-outline' },
  facebook: { label: 'Facebook', icon: 'facebook' },
};

/**
 * Simple, readable details viewer/editor surface for generated platform data.
 * Renders tabs for each platform present in `data`. Only shows fields that exist.
 */
export default function ProductDetailsForm({ mode = 'generate', data, initialTab, title, onOpenFieldPanel }: Props) {
  const platformKeys = useMemo(() => Object.keys(data || {}), [data]);
  const defaultTab = useMemo(() => initialTab && data[initialTab] ? initialTab : (platformKeys.includes('shopify') ? 'shopify' : platformKeys[0]), [initialTab, platformKeys, data]);
  const [active, setActive] = useState<string | undefined>(defaultTab);

  const current = active ? data[active] : undefined;

  const renderField = (label: string, value: any, key?: string) => {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
    return (
      <View style={styles.fieldRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          {!!onOpenFieldPanel && !!key && (
            <TouchableOpacity onPress={() => onOpenFieldPanel(key)}>
              <Icon name="information-outline" size={18} color="#000" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.fieldValue}>{String(value)}</Text>
      </View>
    );
  };

  if (!platformKeys.length) {
    return (
      <View style={styles.card}> 
        <Text style={styles.heading}>No platform data</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {title ? <Text style={styles.heading}>{title}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4 }}>
        {platformKeys.map((key) => (
          <TouchableOpacity
            key={key}
            onPress={() => setActive(key)}
            style={[styles.tab, active === key && styles.tabActive]}
          >
            <Icon name={PLATFORM_META[key]?.icon || 'store'} size={18} color={active === key ? '#000' : '#666'} />
            <Text style={[styles.tabText, active === key && styles.tabTextActive]}>
              {PLATFORM_META[key]?.label || key}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View>
        {!!current && (
          <>
            {renderField('Title', current.title, 'title')}
            {renderField('Price', current.price, 'price')}
            {renderField('Description', current.description, 'description')}
            {renderField('Tags', Array.isArray(current.tags) ? current.tags.join(', ') : current.tags, 'tags')}
            {renderField('Brand', current.brand, 'brand')}
            {renderField('Condition', current.condition, 'condition')}
            {renderField('SKU', current.sku, 'sku')}
            {renderField('Barcode', current.barcode, 'barcode')}
            {renderField('Weight', current.weight, 'weight')}
            {renderField('Weight Unit', current.weightUnit, 'weightUnit')}
            {renderField('Product Type', current.productType, 'productType')}
            {renderField('Vendor', current.vendor, 'vendor')}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { color: '#000', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabActive: { backgroundColor: 'rgba(147,200,34,0.12)', borderColor: '#93C822' },
  tabText: { color: '#666' },
  tabTextActive: { color: '#000', fontWeight: '600' },
  card: { padding: 12 },
  fieldRow: { marginBottom: 8 },
  fieldLabel: { color: '#71717A', fontWeight: '600', marginBottom: 2, fontSize: 12, textTransform: 'uppercase' },
  fieldValue: { color: '#000' },
});


