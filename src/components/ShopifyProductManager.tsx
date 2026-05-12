import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
  FlatList,
  StyleSheet,
} from 'react-native';
import { useShopifyProducts, UseShopifyProductsConfig } from '../hooks/useShopifyProducts';
import { Product, Location } from '../../lib/shopifyGraphQL';

interface ShopifyProductManagerProps {
  config: UseShopifyProductsConfig;
}

interface ProductEditModalProps {
  visible: boolean;
  product: Product | null;
  onClose: () => void;
  onSave: (product: Partial<Product> & { id: string }) => void;
}

const ProductEditModal: React.FC<ProductEditModalProps> = ({
  visible,
  product,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState(product?.title || '');
  const [vendor, setVendor] = useState(product?.vendor || '');
  const [productType, setProductType] = useState(product?.productType || '');
  const [tags, setTags] = useState(product?.tags?.join(', ') || '');
  const [description, setDescription] = useState(product?.descriptionHtml || '');

  const handleSave = () => {
    if (!product) return;

    onSave({
      id: product.id,
      title,
      vendor,
      productType,
      tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
      descriptionHtml: description,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Edit Product</Text>
          <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Title</Text>
            <TextInput
              style={styles.textInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Product title"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Vendor</Text>
            <TextInput
              style={styles.textInput}
              value={vendor}
              onChangeText={setVendor}
              placeholder="Vendor name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Product Type</Text>
            <TextInput
              style={styles.textInput}
              value={productType}
              onChangeText={setProductType}
              placeholder="Product type"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Tags (comma separated)</Text>
            <TextInput
              style={styles.textInput}
              value={tags}
              onChangeText={setTags}
              placeholder="tag1, tag2, tag3"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Product description"
              multiline
              numberOfLines={4}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const ShopifyProductManager: React.FC<ShopifyProductManagerProps> = ({ config }) => {
  const {
    products,
    locations,
    selectedLocation,
    loading,
    error,
    hasNextPage,
    
    // Operations
    readProducts,
    updateProduct,
    archiveProduct,
    deleteProduct,
    
    // Location operations
    getProductsByLocation,
    setSelectedLocation,
    
    // Bulk operations
    bulkArchiveProducts,
    
    // Utilities
    clearError,
    refreshData,
    loadMore,
    
    // Filters
    getActiveProducts,
    getArchivedProducts,
    getDraftProducts,
  } = useShopifyProducts(config);

  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [currentFilter, setCurrentFilter] = useState<'ACTIVE' | 'ARCHIVED' | 'DRAFT' | 'ALL'>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');

  const handleProductSelect = (productId: string) => {
    setSelectedProducts(prev => 
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setShowEditModal(true);
  };

  const handleSaveProduct = async (productUpdate: Partial<Product> & { id: string }) => {
    const result = await updateProduct(productUpdate);
    if (result.success) {
      setShowEditModal(false);
      setEditingProduct(null);
      Alert.alert('Success', 'Product updated successfully');
    } else {
      Alert.alert('Error', result.error || 'Failed to update product');
    }
  };

  const handleArchiveProduct = async (productId: string) => {
    Alert.alert(
      'Archive Product',
      'Are you sure you want to archive this product?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            const result = await archiveProduct(productId);
            if (result.success) {
              Alert.alert('Success', 'Product archived successfully');
            } else {
              Alert.alert('Error', result.error || 'Failed to archive product');
            }
          },
        },
      ]
    );
  };

  const handleDeleteProduct = async (productId: string) => {
    Alert.alert(
      'Delete Product',
      'Are you sure you want to permanently delete this product? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await deleteProduct(productId);
            if (result.success) {
              Alert.alert('Success', 'Product deleted successfully');
            } else {
              Alert.alert('Error', result.error || 'Failed to delete product');
            }
          },
        },
      ]
    );
  };

  const handleBulkArchive = async () => {
    if (selectedProducts.length === 0) {
      Alert.alert('No Selection', 'Please select products to archive');
      return;
    }

    Alert.alert(
      'Bulk Archive',
      `Archive ${selectedProducts.length} selected products?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive All',
          style: 'destructive',
          onPress: async () => {
            const result = await bulkArchiveProducts(selectedProducts);
            if (result.success) {
              setSelectedProducts([]);
              Alert.alert('Success', `${result.data.length} products archived successfully`);
            } else {
              Alert.alert('Error', result.error || 'Failed to archive products');
            }
          },
        },
      ]
    );
  };

  const handleLocationChange = async (location: Location) => {
    setSelectedLocation(location);
    await getProductsByLocation(location.id);
  };

  const handleSearch = async () => {
    await readProducts({ query: searchQuery, refresh: true });
  };

  const getFilteredProducts = () => {
    switch (currentFilter) {
      case 'ACTIVE':
        return getActiveProducts();
      case 'ARCHIVED':
        return getArchivedProducts();
      case 'DRAFT':
        return getDraftProducts();
      default:
        return products;
    }
  };

  const renderProduct = ({ item: product }: { item: Product }) => (
    <View style={styles.productCard}>
      <View style={styles.productHeader}>
        <TouchableOpacity
          style={[
            styles.checkbox,
            selectedProducts.includes(product.id) && styles.checkboxSelected,
          ]}
          onPress={() => handleProductSelect(product.id)}
        >
          {selectedProducts.includes(product.id) && (
            <Text style={styles.checkmark}>✓</Text>
          )}
        </TouchableOpacity>
        
        <View style={styles.productInfo}>
          <Text style={styles.productTitle}>{product.title}</Text>
          <Text style={styles.productDetails}>
            {product.vendor} • {product.productType}
          </Text>
          <View style={styles.statusContainer}>
            <Text style={[styles.status, styles[`status${product.status}`]]}>
              {product.status}
            </Text>
            {product.inventoryQuantity !== undefined && (
              <Text style={styles.inventory}>
                Stock: {product.inventoryQuantity}
              </Text>
            )}
          </View>
        </View>
      </View>

      <View style={styles.productActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleEditProduct(product)}
        >
          <Text style={styles.actionButtonText}>Edit</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.archiveButton]}
          onPress={() => handleArchiveProduct(product.id)}
        >
          <Text style={styles.actionButtonText}>Archive</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={() => handleDeleteProduct(product.id)}
        >
          <Text style={styles.actionButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading && products.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading products...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Shopify Products</Text>
        <TouchableOpacity onPress={refreshData} style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={clearError} style={styles.dismissButton}>
            <Text style={styles.dismissButtonText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Location Selector */}
      <View style={styles.locationSelector}>
        <Text style={styles.sectionTitle}>Location:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {locations.map(location => (
            <TouchableOpacity
              key={location.id}
              style={[
                styles.locationChip,
                selectedLocation?.id === location.id && styles.selectedLocationChip,
              ]}
              onPress={() => handleLocationChange(location)}
            >
              <Text
                style={[
                  styles.locationChipText,
                  selectedLocation?.id === location.id && styles.selectedLocationChipText,
                ]}
              >
                {location.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Search and Filters */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search products..."
          onSubmitEditing={handleSearch}
        />
        <TouchableOpacity onPress={handleSearch} style={styles.searchButton}>
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterContainer}>
        {(['ALL', 'ACTIVE', 'ARCHIVED', 'DRAFT'] as const).map(filter => (
          <TouchableOpacity
            key={filter}
            style={[
              styles.filterChip,
              currentFilter === filter && styles.selectedFilterChip,
            ]}
            onPress={() => setCurrentFilter(filter)}
          >
            <Text
              style={[
                styles.filterChipText,
                currentFilter === filter && styles.selectedFilterChipText,
              ]}
            >
              {filter}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bulk Actions */}
      {selectedProducts.length > 0 && (
        <View style={styles.bulkActionsContainer}>
          <Text style={styles.selectionCount}>
            {selectedProducts.length} selected
          </Text>
          <TouchableOpacity onPress={handleBulkArchive} style={styles.bulkActionButton}>
            <Text style={styles.bulkActionButtonText}>Archive Selected</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setSelectedProducts([])} 
            style={styles.clearSelectionButton}
          >
            <Text style={styles.clearSelectionButtonText}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Products List */}
      <FlatList
        data={getFilteredProducts()}
        renderItem={renderProduct}
        keyExtractor={item => item.id}
        style={styles.productsList}
        onEndReached={() => hasNextPage && loadMore()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loading ? (
            <View style={styles.loadingFooter}>
              <ActivityIndicator size="small" color="#007AFF" />
            </View>
          ) : null
        }
      />

      {/* Edit Modal */}
      <ProductEditModal
        visible={showEditModal}
        product={editingProduct}
        onClose={() => {
          setShowEditModal(false);
          setEditingProduct(null);
        }}
        onSave={handleSaveProduct}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  refreshButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 12,
    margin: 16,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    color: '#c62828',
    flex: 1,
  },
  dismissButton: {
    marginLeft: 12,
  },
  dismissButtonText: {
    color: '#c62828',
    fontWeight: '600',
  },
  locationSelector: {
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  locationChip: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  selectedLocationChip: {
    backgroundColor: '#007AFF',
  },
  locationChipText: {
    color: '#333',
    fontSize: 14,
  },
  selectedLocationChipText: {
    color: 'white',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  searchButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterChip: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  selectedFilterChip: {
    backgroundColor: '#007AFF',
  },
  filterChipText: {
    color: '#333',
    fontSize: 14,
  },
  selectedFilterChipText: {
    color: 'white',
  },
  bulkActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#e3f2fd',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  selectionCount: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1976d2',
  },
  bulkActionButton: {
    backgroundColor: '#ff9800',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 8,
  },
  bulkActionButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  clearSelectionButton: {
    backgroundColor: '#999',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  clearSelectionButtonText: {
    color: 'white',
    fontSize: 12,
  },
  productsList: {
    flex: 1,
  },
  productCard: {
    backgroundColor: 'white',
    margin: 8,
    borderRadius: 8,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 4,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  checkmark: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  productInfo: {
    flex: 1,
  },
  productTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  productDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginRight: 8,
  },
  statusACTIVE: {
    backgroundColor: '#e8f5e8',
    color: '#4caf50',
  },
  statusARCHIVED: {
    backgroundColor: '#fff3e0',
    color: '#ff9800',
  },
  statusDRAFT: {
    backgroundColor: '#f3e5f5',
    color: '#9c27b0',
  },
  inventory: {
    fontSize: 12,
    color: '#666',
  },
  productActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  archiveButton: {
    backgroundColor: '#ff9800',
  },
  deleteButton: {
    backgroundColor: '#f44336',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 8,
    color: '#666',
  },
  loadingFooter: {
    padding: 16,
    alignItems: 'center',
  },
  
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: 'white',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  cancelButton: {
    padding: 8,
  },
  cancelButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
});

export default ShopifyProductManager; 