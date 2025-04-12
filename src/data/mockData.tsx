// Sales data for chart
export const mockSalesData = [
  2500, 1800, 3200, 2100, 4500, 3800, 2800, 1900, 3900, 3100, 4200, 3400
];

// Channel data for bars
export const mockChannelData = [
  {
    name: 'Shopify',
    percentage: 45,
    value: '305',
    color: '#0E8F7F'
  },
  {
    name: 'Amazon',
    percentage: 35,
    value: '237',
    color: '#F17F5F'
  },
  {
    name: 'Clover',
    percentage: 28,
    value: '186',
    color: '#3CAD46'
  },
  {
    name: 'Square',
    percentage: 11,
    value: '73',
    color: '#6C757D'
  }
];

// Orders data for list
export const mockOrders = [
  {
    id: '1',
    customer: 'John Smith',
    date: '2023-09-15',
    total: 129.99,
    status: 'processing',
    platform: 'Shopify',
    items: 3
  },
  {
    id: '2',
    customer: 'Sarah Johnson',
    date: '2023-09-14',
    total: 79.50,
    status: 'pending',
    platform: 'Amazon',
    items: 2
  },
  {
    id: '3',
    customer: 'Michael Brown',
    date: '2023-09-14',
    total: 215.75,
    status: 'completed',
    platform: 'eBay',
    items: 4
  },
  {
    id: '4',
    customer: 'Emily Davis',
    date: '2023-09-13',
    total: 149.95,
    status: 'intransit',
    platform: 'Etsy',
    items: 1
  },
  {
    id: '5',
    customer: 'Robert Wilson',
    date: '2023-09-12',
    total: 32.99,
    status: 'returned',
    platform: 'Clover',
    items: 1
  },
  {
    id: '6',
    customer: 'Jennifer Martinez',
    date: '2023-09-11',
    total: 189.50,
    status: 'delivered',
    platform: 'Square',
    items: 3
  },
  {
    id: '7',
    customer: 'David Thompson',
    date: '2023-09-10',
    total: 62.75,
    status: 'offloaded',
    platform: 'Facebook',
    items: 2
  },
  {
    id: '8',
    customer: 'Lisa Anderson',
    date: '2023-09-09',
    total: 129.99,
    status: 'processing',
    platform: 'Shopify',
    items: 3
  },
  // Add more orders as needed
];

// Inventory items for inventory screen
export const mockInventoryItems = [
  {
    id: 1,
    title: 'Vintage Caribbean Seafood Cookbook',
    usePlaceholder: true,
    price: 24.99,
    quantity: 45,
    platforms: ['shopify', 'amazon'],
    date: '2023-11-15T12:00:00Z',
    status: 'active'
  },
  {
    id: 2,
    title: 'African Spices Gift Set',
    usePlaceholder: true,
    price: 39.99,
    quantity: 23,
    platforms: ['shopify', 'clover', 'square'],
    date: '2023-11-12T12:00:00Z',
    status: 'active'
  },
  {
    id: 3,
    title: 'Handmade Caribbean Wooden Bowl',
    usePlaceholder: true,
    price: 59.99,
    quantity: 12,
    platforms: ['amazon', 'shopify'],
    date: '2023-11-10T12:00:00Z',
    status: 'active'
  },
  {
    id: 4,
    title: 'Traditional Jamaican Coffee Beans',
    usePlaceholder: true,
    price: 19.99,
    quantity: 78,
    platforms: ['shopify', 'amazon', 'clover'],
    date: '2023-11-05T12:00:00Z',
    status: 'active'
  },
  {
    id: 5,
    title: 'Caribbean Sea Salt Collection',
    usePlaceholder: true,
    price: 34.99,
    quantity: 32,
    platforms: ['square', 'amazon'],
    date: '2023-11-01T12:00:00Z',
    status: 'active'
  },
  {
    id: 1,
    title: 'Commercial Hot Dog Warming Machine',
    usePlaceholder: true,
    price: 129.99,
    quantity: 15,
    platforms: ['shopify', 'amazon', 'ebay'],
    date: '2023-11-15T12:00:00Z',
    status: 'active'
  },
  {
    id: 2,
    title: 'Organic Coconut Oil - 32oz',
    usePlaceholder: true,
    price: 24.99,
    quantity: 87,
    platforms: ['shopify', 'amazon', 'whatnot'],
    date: '2023-11-12T12:00:00Z',
    status: 'active'
  },
  {
    id: 3,
    title: 'Caribbean Vibes Graphic T-Shirt',
    usePlaceholder: true,
    price: 29.99,
    quantity: 42,
    platforms: ['depop', 'shopify', 'ebay'],
    date: '2023-11-10T12:00:00Z',
    status: 'active'
  }
]; 