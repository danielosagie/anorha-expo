import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  ScrollView,
} from 'react-native';
import ShopifyProductManager from '../components/ShopifyProductManager';
import { UseShopifyProductsConfig } from '../hooks/useShopifyProducts';

// Example configuration component
const ShopifyConfigSetup: React.FC<{
  onConfigSet: (config: UseShopifyProductsConfig) => void;
}> = ({ onConfigSet }) => {
  const [storeName, setStoreName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountId, setAccountId] = useState('');

  const handleSaveConfig = () => {
    if (!storeName || !accessToken) {
      Alert.alert('Error', 'Please enter both store name and access token');
      return;
    }

    onConfigSet({
      storeName: storeName.replace('.myshopify.com', ''), // Remove domain if included
      accessToken,
      accountId: accountId || undefined,
    });
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Shopify Configuration</Text>
        <Text style={styles.subtitle}>
          Configure your Shopify store credentials to manage products
        </Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Store Name</Text>
          <TextInput
            style={styles.input}
            value={storeName}
            onChangeText={setStoreName}
            placeholder="your-store-name (without .myshopify.com)"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helpText}>
            Enter your store name without the .myshopify.com domain
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Access Token</Text>
          <TextInput
            style={styles.input}
            value={accessToken}
            onChangeText={setAccessToken}
            placeholder="shpat_..."
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helpText}>
            Your Shopify Admin API access token with product permissions
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Account ID (Optional)</Text>
          <TextInput
            style={styles.input}
            value={accountId}
            onChangeText={setAccountId}
            placeholder="account-123"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helpText}>
            Optional account identifier for multi-account support
          </Text>
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={handleSaveConfig}>
          <Text style={styles.saveButtonText}>Connect to Shopify</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>Required Permissions</Text>
        <Text style={styles.infoText}>
          Your Shopify app needs the following permissions:
        </Text>
        <View style={styles.permissionsList}>
          <Text style={styles.permission}>• read_products</Text>
          <Text style={styles.permission}>• write_products</Text>
          <Text style={styles.permission}>• read_inventory</Text>
          <Text style={styles.permission}>• write_inventory</Text>
          <Text style={styles.permission}>• read_locations</Text>
        </View>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>Features Available</Text>
        <View style={styles.featuresList}>
          <Text style={styles.feature}>✓ Read products with pagination</Text>
          <Text style={styles.feature}>✓ Update product details</Text>
          <Text style={styles.feature}>✓ Archive products (soft delete)</Text>
          <Text style={styles.feature}>✓ Delete products (hard delete)</Text>
          <Text style={styles.feature}>✓ Filter by location</Text>
          <Text style={styles.feature}>✓ Inventory management by location</Text>
          <Text style={styles.feature}>✓ Bulk operations</Text>
          <Text style={styles.feature}>✓ Search and filtering</Text>
        </View>
      </View>
    </ScrollView>
  );
};

// Main integration example
const ShopifyIntegrationExample: React.FC = () => {
  const [config, setConfig] = useState<UseShopifyProductsConfig | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const handleConfigSet = (newConfig: UseShopifyProductsConfig) => {
    setConfig(newConfig);
    setShowConfig(false);
    Alert.alert('Success', 'Shopify configuration saved!');
  };

  const handleResetConfig = () => {
    Alert.alert(
      'Reset Configuration',
      'Are you sure you want to reset your Shopify configuration?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setConfig(null);
            setShowConfig(false);
          },
        },
      ]
    );
  };

  if (!config) {
    return (
      <ShopifyConfigSetup onConfigSet={handleConfigSet} />
    );
  }

  if (showConfig) {
    return (
      <ShopifyConfigSetup onConfigSet={handleConfigSet} />
    );
  }

  return (
    <View style={styles.container}>
      {/* Configuration Header */}
      <View style={styles.configHeader}>
        <View>
          <Text style={styles.configTitle}>
            Connected to: {config.storeName}.myshopify.com
          </Text>
          {config.accountId && (
            <Text style={styles.configSubtitle}>
              Account: {config.accountId}
            </Text>
          )}
        </View>
        <View style={styles.configActions}>
          <TouchableOpacity
            style={styles.configButton}
            onPress={() => setShowConfig(true)}
          >
            <Text style={styles.configButtonText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.configButton, styles.resetButton]}
            onPress={handleResetConfig}
          >
            <Text style={styles.configButtonText}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Shopify Product Manager */}
      <ShopifyProductManager config={config} />
    </View>
  );
};

// Integration with existing app screens
export const IntegrateWithExistingScreen = () => {
  // Example of how to add this to an existing screen like InventoryScreen
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Your Existing Inventory</Text>
      {/* Your existing inventory components */}
      
      <Text style={styles.sectionTitle}>Shopify Integration</Text>
      <ShopifyIntegrationExample />
    </View>
  );
};

// Example hook usage in a custom component
export const CustomShopifyComponent: React.FC = () => {
  // This shows how to use the hook directly in your own components
  const config = {
    storeName: 'your-store',
    accessToken: 'your-token',
  };

  // You can uncomment this when you have valid credentials
  /*
  const {
    products,
    loading,
    error,
    readProducts,
    updateProduct,
    archiveProduct,
    getProductsByLocation,
  } = useShopifyProducts(config);

  const handleCustomOperation = async () => {
    // Example of custom product operation
    const result = await readProducts({ query: 'title:*shirt*' });
    if (result.success) {
      console.log('Found products:', result.data.products);
    }
  };
  */

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Custom Shopify Integration</Text>
      <Text style={styles.subtitle}>
        This demonstrates how to use the Shopify hooks directly
      </Text>
      {/* Add your custom implementation here */}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    lineHeight: 22,
  },
  form: {
    padding: 20,
    backgroundColor: 'white',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  helpText: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
    lineHeight: 18,
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  infoSection: {
    margin: 20,
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    lineHeight: 20,
  },
  permissionsList: {
    marginLeft: 8,
  },
  permission: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  featuresList: {
    marginLeft: 8,
  },
  feature: {
    fontSize: 14,
    color: '#333',
    marginBottom: 6,
    lineHeight: 18,
  },
  configHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#e8f5e8',
    borderBottomWidth: 1,
    borderBottomColor: '#4caf50',
  },
  configTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2e7d32',
  },
  configSubtitle: {
    fontSize: 14,
    color: '#4caf50',
    marginTop: 2,
  },
  configActions: {
    flexDirection: 'row',
  },
  configButton: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  resetButton: {
    backgroundColor: '#f44336',
  },
  configButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    margin: 16,
    marginBottom: 8,
  },
});

export default ShopifyIntegrationExample; 