export interface ShopifyConfig {
  storeName: string;
  accessToken: string;
}

export interface Product {
  id: string;
  title: string;
  handle: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  vendor: string;
  productType: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  descriptionHtml: string;
  tags: string[];
  variants: ProductVariant[];
  media: ProductMedia[];
  inventoryQuantity?: number;
}

export interface ProductVariant {
  id: string;
  title: string;
  price: string;
  compareAtPrice?: string;
  sku?: string;
  barcode?: string;
  inventoryQuantity: number;
  inventoryItem: {
    id: string;
  };
  position: number;
  availableForSale: boolean;
}

export interface ProductMedia {
  id: string;
  mediaContentType: string;
  image?: {
    url: string;
    altText?: string;
  };
}

export interface Location {
  id: string;
  name: string;
  address: {
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    country?: string;
    zip?: string;
  };
  active: boolean;
}

export interface InventoryLevel {
  id: string;
  available: number;
  location: Location;
  inventoryItem: {
    id: string;
  };
}

// GraphQL Queries

export const GET_PRODUCTS_QUERY = `
  query getProducts($first: Int, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          createdAt
          updatedAt
          publishedAt
          descriptionHtml
          tags
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                sku
                barcode
                inventoryQuantity
                inventoryItem {
                  id
                }
                position
                availableForSale
              }
            }
          }
          media(first: 5) {
            edges {
              node {
                id
                mediaContentType
                ... on MediaImage {
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_PRODUCT_BY_ID_QUERY = `
  query getProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      vendor
      productType
      createdAt
      updatedAt
      publishedAt
      descriptionHtml
      tags
      variants(first: 50) {
        edges {
          node {
            id
            title
            price
            compareAtPrice
            sku
            barcode
            inventoryQuantity
            inventoryItem {
              id
            }
            position
            availableForSale
          }
        }
      }
      media(first: 10) {
        edges {
          node {
            id
            mediaContentType
            ... on MediaImage {
              image {
                url
                altText
              }
            }
          }
        }
      }
    }
  }
`;

export const GET_LOCATIONS_QUERY = `
  query getLocations($first: Int) {
    locations(first: $first) {
      edges {
        node {
          id
          name
          address {
            address1
            address2
            city
            province
            country
            zip
          }
          active
        }
      }
    }
  }
`;

export const GET_INVENTORY_LEVELS_QUERY = `
  query getInventoryLevels($inventoryItemId: ID!, $locationIds: [ID!]) {
    inventoryItem(id: $inventoryItemId) {
      id
      inventoryLevels(first: 50, locationIds: $locationIds) {
        edges {
          node {
            id
            available
            location {
              id
              name
              address {
                address1
                city
                province
                country
              }
            }
          }
        }
      }
    }
  }
`;

// GraphQL Mutations

export const UPDATE_PRODUCT_MUTATION = `
  mutation updateProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        handle
        status
        vendor
        productType
        descriptionHtml
        tags
        updatedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const DELETE_PRODUCT_MUTATION = `
  mutation deleteProduct($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

export const ARCHIVE_PRODUCT_MUTATION = `
  mutation archiveProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        status
        updatedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const UNPUBLISH_PRODUCT_MUTATION = `
  mutation unpublishProduct($input: ProductUnpublishInput!) {
    productUnpublish(input: $input) {
      product {
        id
        publishedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ADJUST_INVENTORY_MUTATION = `
  mutation adjustInventory($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
        reason
        referenceDocumentUri
        app {
          id
        }
        changes {
          name
          delta
          quantityAfterChange
          item {
            id
          }
          location {
            id
            name
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// API Helper Functions

export class ShopifyGraphQLClient {
  private config: ShopifyConfig;

  constructor(config: ShopifyConfig) {
    this.config = config;
  }

  private async makeRequest(query: string, variables?: any): Promise<any> {
    const url = `https://${this.config.storeName}.myshopify.com/admin/api/2024-01/graphql.json`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.config.accessToken,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  }

  // Read Operations
  async getProducts(first: number = 50, after?: string, query?: string): Promise<{ products: Product[], hasNextPage: boolean, endCursor?: string }> {
    const data = await this.makeRequest(GET_PRODUCTS_QUERY, { first, after, query });
    
    const products = data.products.edges.map((edge: any) => ({
      ...edge.node,
      variants: edge.node.variants.edges.map((v: any) => v.node),
      media: edge.node.media.edges.map((m: any) => m.node),
    }));

    return {
      products,
      hasNextPage: data.products.pageInfo.hasNextPage,
      endCursor: data.products.pageInfo.endCursor,
    };
  }

  async getProductById(id: string): Promise<Product | null> {
    const data = await this.makeRequest(GET_PRODUCT_BY_ID_QUERY, { id });
    
    if (!data.product) return null;

    return {
      ...data.product,
      variants: data.product.variants.edges.map((v: any) => v.node),
      media: data.product.media.edges.map((m: any) => m.node),
    };
  }

  async getLocations(first: number = 50): Promise<Location[]> {
    const data = await this.makeRequest(GET_LOCATIONS_QUERY, { first });
    return data.locations.edges.map((edge: any) => edge.node);
  }

  async getInventoryLevels(inventoryItemId: string, locationIds?: string[]): Promise<InventoryLevel[]> {
    const data = await this.makeRequest(GET_INVENTORY_LEVELS_QUERY, { 
      inventoryItemId, 
      locationIds 
    });
    return data.inventoryItem.inventoryLevels.edges.map((edge: any) => edge.node);
  }

  // Update Operations
  async updateProduct(productUpdate: Partial<Product> & { id: string }): Promise<Product> {
    const input = {
      id: productUpdate.id,
      title: productUpdate.title,
      descriptionHtml: productUpdate.descriptionHtml,
      vendor: productUpdate.vendor,
      productType: productUpdate.productType,
      tags: productUpdate.tags,
      status: productUpdate.status,
      handle: productUpdate.handle,
    };

    const data = await this.makeRequest(UPDATE_PRODUCT_MUTATION, { product: input });
    
    if (data.productUpdate.userErrors.length > 0) {
      throw new Error(`Update failed: ${JSON.stringify(data.productUpdate.userErrors)}`);
    }

    return data.productUpdate.product;
  }

  // Archive/Delist Operations (instead of hard delete)
  async archiveProduct(productId: string): Promise<Product> {
    const input = {
      id: productId,
      status: 'ARCHIVED',
    };

    const data = await this.makeRequest(ARCHIVE_PRODUCT_MUTATION, { product: input });
    
    if (data.productUpdate.userErrors.length > 0) {
      throw new Error(`Archive failed: ${JSON.stringify(data.productUpdate.userErrors)}`);
    }

    return data.productUpdate.product;
  }

  async unpublishProduct(productId: string, publicationIds: string[]): Promise<any> {
    const input = {
      id: productId,
      productPublications: publicationIds.map(id => ({ publicationId: id })),
    };

    const data = await this.makeRequest(UNPUBLISH_PRODUCT_MUTATION, { input });
    
    if (data.productUnpublish.userErrors.length > 0) {
      throw new Error(`Unpublish failed: ${JSON.stringify(data.productUnpublish.userErrors)}`);
    }

    return data.productUnpublish.product;
  }

  // Delete Operations (hard delete - use with caution)
  async deleteProduct(productId: string): Promise<string> {
    const input = { id: productId };

    const data = await this.makeRequest(DELETE_PRODUCT_MUTATION, { input });
    
    if (data.productDelete.userErrors.length > 0) {
      throw new Error(`Delete failed: ${JSON.stringify(data.productDelete.userErrors)}`);
    }

    return data.productDelete.deletedProductId;
  }

  // Inventory Operations by Location
  async adjustInventoryAtLocation(
    inventoryItemId: string,
    locationId: string,
    quantityDelta: number,
    reason: string = 'correction'
  ): Promise<any> {
    const input = {
      reason,
      name: 'available',
      changes: [
        {
          delta: quantityDelta,
          inventoryItemId,
          locationId,
        },
      ],
    };

    const data = await this.makeRequest(ADJUST_INVENTORY_MUTATION, { input });
    
    if (data.inventoryAdjustQuantities.userErrors.length > 0) {
      throw new Error(`Inventory adjustment failed: ${JSON.stringify(data.inventoryAdjustQuantities.userErrors)}`);
    }

    return data.inventoryAdjustQuantities.inventoryAdjustmentGroup;
  }

  // Bulk Operations
  async bulkArchiveProducts(productIds: string[]): Promise<Product[]> {
    const results = await Promise.allSettled(
      productIds.map(id => this.archiveProduct(id))
    );

    const successful = results
      .filter((result): result is PromiseFulfilledResult<Product> => result.status === 'fulfilled')
      .map(result => result.value);

    const failed = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);

    if (failed.length > 0) {
      console.warn('Some products failed to archive:', failed);
    }

    return successful;
  }

  async getProductsByLocation(locationId: string, first: number = 50): Promise<Product[]> {
    // Get products and filter by those that have inventory at the specified location
    const { products } = await this.getProducts(first);
    
    const productsWithInventory = await Promise.all(
      products.map(async (product) => {
        const variant = product.variants[0]; // Check first variant for simplicity
        if (!variant?.inventoryItem?.id) return null;

        try {
          const inventoryLevels = await this.getInventoryLevels(variant.inventoryItem.id, [locationId]);
          if (inventoryLevels.length > 0 && inventoryLevels[0].available > 0) {
            return { ...product, inventoryQuantity: inventoryLevels[0].available };
          }
        } catch (error) {
          console.warn(`Could not get inventory for product ${product.id}:`, error);
        }
        
        return null;
      })
    );

    return productsWithInventory.filter((product): product is Product => product !== null);
  }
}

// Example usage and configuration
export const createShopifyClient = (storeName: string, accessToken: string) => {
  return new ShopifyGraphQLClient({ storeName, accessToken });
}; 