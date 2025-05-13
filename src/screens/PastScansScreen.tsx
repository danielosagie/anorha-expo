import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import { supabase } from '../../lib/supabase';
import AddListingScreen from './AddListingScreen';
import { AppStackParamList } from '../navigation/AppNavigator';

interface PastScan {
  id: string;
  variantId: string;
  created_at: string;
  title: string;
  description: string;
  price: number;
  sku: string;
  barcode: string;
  images: string[];
  platform_details: any;
  status: 'draft' | 'active' | 'archived';
}

// Add type for navigation
type PastScansScreenNavigationProp = StackNavigationProp<AppStackParamList, 'PastScans'>;

const PastScansScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation<PastScansScreenNavigationProp>();
  const [scans, setScans] = useState<PastScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPastScans();
  }, []);

  const fetchPastScans = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('No authenticated user');
      }

      // Query Products with their variants and AI content
      const { data: products, error: productsError } = await supabase
        .from('Products')
        .select(`
          Id,
          CreatedAt,
          IsArchived,
          UpdatedAt,
          ProductVariants (
            Id,
            Title,
            Description,
            Price,
            CompareAtPrice,
            Sku,
            Barcode,
            Weight,
            WeightUnit,
            Options,
            CreatedAt,
            UpdatedAt,
            ProductImages (
              ImageUrl,
              Position
            )
          ),
          AiGeneratedContent (
            Id,
            ContentType,
            GeneratedText,
            IsActive,
            CreatedAt,
            UpdatedAt
          )
        `)
        .eq('UserId', user.id)
        .order('CreatedAt', { ascending: false });

      if (productsError) {
        console.error('Database error:', productsError);
        throw new Error('Failed to fetch products');
      }

      if (!products || products.length === 0) {
        setScans([]);
        return;
      }

      // Transform the data to match our PastScan interface
      const transformedScans = products.map(product => {
        // Get the first variant (we'll need to handle multiple variants later)
        const variant = product.ProductVariants?.[0];
        if (!variant) {
          console.warn(`Product ${product.Id} has no variants`);
          return null;
        }

        // Get the most recent AI content
        const aiContent = product.AiGeneratedContent?.[0];
        
        // Sort images by position and get URLs
        const sortedImages = variant.ProductImages
          ?.sort((a, b) => (a.Position || 0) - (b.Position || 0))
          ?.map(img => img.ImageUrl) || [];

        // Determine status based on both IsArchived and AI content
        let status: 'draft' | 'active' | 'archived' = 'draft';
        if (product.IsArchived) {
          status = 'archived';
        } else if (aiContent?.IsActive) {
          status = 'active';
        }

        // Get platform details from AI content if available
        let platformDetails = {};
        if (aiContent?.GeneratedText) {
          try {
            const parsedContent = JSON.parse(aiContent.GeneratedText);
            // Only include the generated details if they exist
            if (parsedContent?.generatedDetails) {
              platformDetails = parsedContent.generatedDetails;
            }
          } catch (e) {
            console.warn(`Failed to parse AI generated content for product ${product.Id}:`, e);
          }
        }

        return {
          id: product.Id,
          variantId: variant.Id,
          created_at: product.CreatedAt,
          title: variant.Title || 'Untitled Product',
          description: variant.Description || '',
          price: variant.Price || 0,
          sku: variant.Sku || '',
          barcode: variant.Barcode || '',
          images: sortedImages,
          platform_details: platformDetails,
          status
        };
      }).filter((scan): scan is PastScan => scan !== null); // Remove any null entries

      setScans(transformedScans);
    } catch (err: any) {
      console.error('Error in fetchPastScans:', err);
      setError(err.message || 'Failed to fetch past scans');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadScan = (scan: PastScan) => {
    // Navigate to AddListingScreen with the scan data and initial stage
    navigation.navigate('AddListing', {
      initialData: {
        title: scan.title,
        description: scan.description,
        price: scan.price,
        sku: scan.sku,
        barcode: scan.barcode,
        images: scan.images,
        platformDetails: scan.platform_details,
        status: scan.status,
        // Add these to ensure we go directly to form review
        initialStage: 'FORM_REVIEW',
        productId: scan.id, // Pass the product ID to load existing data
        // Include any other necessary data for the form
        variantId: scan.variantId, // Make sure to include this in the PastScan interface
        uploadedImageUrls: scan.images, // Pass the image URLs directly
      }
    });
  };

  const renderScanItem = ({ item }: { item: PastScan }) => (
    <Card style={styles.scanCard}>
      <TouchableOpacity 
        style={styles.scanItem}
        onPress={() => handleLoadScan(item)}
      >
        <View style={styles.scanInfo}>
          <Text style={styles.scanTitle}>{item.title}</Text>
          <Text style={styles.scanDate}>
            {new Date(item.created_at).toLocaleDateString()}
          </Text>
          <View style={styles.scanDetails}>
            <Text style={styles.scanDetail}>SKU: {item.sku || 'N/A'}</Text>
            <Text style={styles.scanDetail}>Price: ${item.price.toFixed(2)}</Text>
          </View>
          <View style={styles.scanStatus}>
            <Icon 
              name={item.status === 'active' ? 'check-circle' : 
                    item.status === 'archived' ? 'archive' : 'pencil'} 
              size={16} 
              color={item.status === 'active' ? theme.colors.success : 
                     item.status === 'archived' ? theme.colors.textSecondary : 
                     theme.colors.primary} 
            />
            <Text style={[
              styles.statusText,
              { color: item.status === 'active' ? theme.colors.success : 
                      item.status === 'archived' ? theme.colors.textSecondary : 
                      theme.colors.primary }
            ]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={24} color={theme.colors.textSecondary} />
      </TouchableOpacity>
    </Card>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Button 
          title="Try Again" 
          onPress={fetchPastScans}
          style={styles.retryButton}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Past Scans</Text>
      </View>

      <FlatList
        data={scans}
        renderItem={renderScanItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="history" size={48} color={theme.colors.textSecondary} />
            <Text style={styles.emptyText}>No past scans found</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginTop: 50,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 16,
  },
  scanCard: {
    marginBottom: 12,
  },
  scanItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  scanInfo: {
    flex: 1,
  },
  scanTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  scanDate: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  scanDetails: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  scanDetail: {
    fontSize: 12,
    color: '#666',
    marginRight: 16,
  },
  scanStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    marginLeft: 4,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  errorText: {
    color: '#ff3b30',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 120,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});

export default PastScansScreen; 