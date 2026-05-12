/**
 * Platform Field Schemas
 * 
 * Defines the UI field structure for each platform.
 * Used by ListingEditorForm to render platform-specific fields.
 */

export const PLATFORM_FIELD_SCHEMA: Record<string, any> = {
    shopify: {
        title: { type: 'string', label: 'Title', required: true },
        description: { type: 'string', label: 'Description', multiline: true },
        vendor: { type: 'string', label: 'Vendor' },
        productCategory: { type: 'string', label: 'Product Category' },
        productType: { type: 'string', label: 'Product Type' },
        tags: { type: 'array', label: 'Tags' },
        status: { type: 'select', label: 'Status', options: ['active', 'draft', 'archived'] },
        variants: {
            type: 'array',
            label: 'Variants',
            schema: {
                sku: { type: 'string', label: 'SKU' },
                barcode: { type: 'string', label: 'Barcode' },
                price: { type: 'number', label: 'Price' },
                compareAtPrice: { type: 'number', label: 'Compare At Price' },
                costPerItem: { type: 'number', label: 'Cost Per Item' },
                weightValueGrams: { type: 'number', label: 'Weight (g)' },
                requiresShipping: { type: 'boolean', label: 'Requires Shipping' },
            }
        },
        images: { type: 'array', label: 'Images' },
        seo: {
            type: 'object',
            label: 'SEO',
            schema: {
                seoTitle: { type: 'string', label: 'SEO Title' },
                seoDescription: { type: 'string', label: 'SEO Description', multiline: true }
            }
        },
    },

    amazon: {
        sku: { type: 'string', label: 'SKU', required: true },
        productId: { type: 'string', label: 'Product ID' },
        productIdType: { type: 'select', label: 'ID Type', options: ['UPC', 'EAN', 'ASIN'] },
        title: { type: 'string', label: 'Title', required: true },
        brand: { type: 'string', label: 'Brand' },
        description: { type: 'string', label: 'Description', multiline: true },
        bullet_points: { type: 'array', label: 'Bullet Points' },
        price: { type: 'number', label: 'Price', required: true },
        quantity: { type: 'number', label: 'Quantity' },
        condition: { type: 'select', label: 'Condition', options: ['New', 'Refurbished', 'Used'] }
    },

    ebay: {
        title: { type: 'string', label: 'Title', required: true },
        subtitle: { type: 'string', label: 'Subtitle' },
        description: { type: 'string', label: 'Description', multiline: true },
        category: { type: 'string', label: 'Category' },
        conditionID: { type: 'number', label: 'Condition ID' },
        listingDetails: {
            type: 'object',
            label: 'Listing Details',
            schema: {
                format: { type: 'select', label: 'Format', options: ['FixedPrice', 'Auction'] },
                startPrice: { type: 'number', label: 'Price' },
                quantity: { type: 'number', label: 'Quantity' },
                bestOfferEnabled: { type: 'boolean', label: 'Best Offer' },
            }
        },
    },

    facebook: {
        title: { type: 'string', label: 'Title', required: true },
        description: { type: 'string', label: 'Description', multiline: true },
        availability: { type: 'select', label: 'Availability', options: ['in stock', 'out of stock'] },
        condition: { type: 'select', label: 'Condition', options: ['new', 'refurbished', 'used'] },
        price: { type: 'string', label: 'Price' },
        brand: { type: 'string', label: 'Brand' },
    },

    square: {
        name: { type: 'string', label: 'Name', required: true },
        description: { type: 'string', label: 'Description', multiline: true },
        sku: { type: 'string', label: 'SKU' },
        price: { type: 'number', label: 'Price' },
    },

    clover: {
        name: { type: 'string', label: 'Name', required: true },
        price: { type: 'number', label: 'Price', required: true },
        sku: { type: 'string', label: 'SKU' },
        category: { type: 'string', label: 'Category' },
    },

    whatnot: {
        title: { type: 'string', label: 'Title', required: true },
        description: { type: 'string', label: 'Description', multiline: true },
        category: { type: 'string', label: 'Category' },
        price: { type: 'number', label: 'Price', required: true },
        quantity: { type: 'number', label: 'Quantity' },
        condition: { type: 'string', label: 'Condition' },
        sku: { type: 'string', label: 'SKU' },
    }
};
