import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import { supabase } from '../../lib/supabase';
import { AppStackParamList } from '../navigation/AppNavigator';

// --- Interfaces for Data Types ---

// For the "Generated Listings" tab (existing data structure)
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

// For the "Match Jobs" tab
interface MatchJob {
  id: string; // This is the job_id from the table
  created_at: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  summary: {
    highConfidenceCount?: number;
    mediumConfidenceCount?: number;
    lowConfidenceCount?: number;
    totalProducts?: number;
  };
  // We don't need the full results here, just the ID to navigate
}

type PastScansScreenNavigationProp = StackNavigationProp<AppStackParamList, 'PastScans'>;

const PastScansScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation<PastScansScreenNavigationProp>();
  
  const [activeTab, setActiveTab] = useState<'matches' | 'listings'>('matches');
  const [matchJobs, setMatchJobs] = useState<MatchJob[]>([]);
  const [scans, setScans] = useState<PastScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatchJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user');

      const { data, error } = await supabase
        .from('match_jobs')
        .select('job_id, created_at, status, summary')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching match jobs:', error);
        throw new Error('Failed to fetch match jobs.');
      }
      
      // The table has `job_id`, but our keyExtractor needs `id`. Let's map it.
      const formattedJobs = data.map(job => ({ ...job, id: job.job_id })) as MatchJob[];
      setMatchJobs(formattedJobs);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPastScans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error('No authenticated user');

      const { data: products, error: productsError } = await supabase
        .from('Products')
        .select(`
          Id,
          CreatedAt,
          IsArchived,
          ProductVariants (
            Id,
            Title,
            Description,
            Price,
            Sku,
            Barcode,
            Options,
            ProductImages!ProductImages_ProductVariantId_fkey ( ImageUrl, Position )
          )
        `)
        .eq('UserId', user.id)
        .order('CreatedAt', { ascending: false });

      if (productsError) {
        console.error('Database error:', productsError);
        throw new Error('Failed to fetch products');
      }

      if (!products) {
        setScans([]);
        return;
      }

      const transformedScans = products.reduce((acc: PastScan[], product) => {
        const variant = product.ProductVariants?.[0];
        if (!variant) return acc;

        const sortedImages = variant.ProductImages
          ?.sort((a, b) => (a.Position || 0) - (b.Position || 0))
          ?.map(img => img.ImageUrl) || [];

        let status: 'draft' | 'active' | 'archived' = product.IsArchived ? 'archived' : (variant.Title ? 'active' : 'draft');
        
        acc.push({
          id: product.Id,
          variantId: variant.Id,
          created_at: product.CreatedAt,
          title: variant.Title || 'Untitled Product',
          description: variant.Description || '',
          price: variant.Price || 0,
          sku: variant.Sku || '',
          barcode: variant.Barcode || '',
          images: sortedImages,
          platform_details: variant.Options || {},
          status
        });
        return acc;
      }, []);

      setScans(transformedScans);
    } catch (err: any) {
      console.error('Error in fetchPastScans:', err);
      setError(err.message || 'Failed to fetch past scans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'matches') {
      fetchMatchJobs();
    } else {
      fetchPastScans();
    }
  }, [activeTab, fetchMatchJobs, fetchPastScans]);

  const handleLoadMatchJob = (job: MatchJob) => {
    if (job.status === 'completed') {
      navigation.navigate('MatchSelectionScreen', {
        // Pass the job ID to the selection screen
        response: { jobId: job.id } 
      });
    } else {
      // Handle other statuses if needed (e.g., show an alert)
      console.log(`Job status is '${job.status}', cannot view results yet.`);
    }
  };

  const handleLoadScan = (scan: PastScan) => {
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
        initialStage: 'FORM_REVIEW',
        productId: scan.id,
        variantId: scan.variantId,
        uploadedImageUrls: scan.images,
      }
    });
  };

  const renderMatchJobItem = ({ item }: { item: MatchJob }) => (
    <Card style={styles.scanCard}>
      <TouchableOpacity 
        style={styles.scanItem}
        onPress={() => handleLoadMatchJob(item)}
        disabled={item.status !== 'completed'}
      >
        <View style={styles.scanInfo}>
          <Text style={styles.scanTitle}>Match Job</Text>
          <Text style={styles.scanDate}>
            {new Date(item.created_at).toLocaleString()}
          </Text>
          <View style={styles.scanDetails}>
             <Text style={styles.scanDetail}>
                High: {item.summary?.highConfidenceCount ?? 0}
             </Text>
             <Text style={styles.scanDetail}>
                Med: {item.summary?.mediumConfidenceCount ?? 0}
             </Text>
             <Text style={styles.scanDetail}>
                Low: {item.summary?.lowConfidenceCount ?? 0}
             </Text>
          </View>
          <View style={styles.scanStatus}>
            <Icon 
              name={item.status === 'completed' ? 'check-circle' : 'cogs'} 
              size={16} 
              color={item.status === 'completed' ? theme.colors.success : theme.colors.primary} 
            />
            <Text style={[
              styles.statusText,
              { color: item.status === 'completed' ? theme.colors.success : theme.colors.primary }
            ]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={24} color={item.status === 'completed' ? theme.colors.textSecondary : '#ccc'} />
      </TouchableOpacity>
    </Card>
  );

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

  const renderContent = () => {
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
            onPress={activeTab === 'matches' ? fetchMatchJobs : fetchPastScans}
            style={styles.retryButton}
          />
        </View>
      );
    }

    return (
      <FlatList
        data={activeTab === 'matches' ? matchJobs : scans}
        renderItem={activeTab === 'matches' ? renderMatchJobItem : renderScanItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="history" size={48} color={theme.colors.textSecondary} />
            <Text style={styles.emptyText}>
              {activeTab === 'matches' ? 'No match jobs found' : 'No generated listings found'}
            </Text>
          </View>
        }
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>History</Text>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'matches' && styles.activeTab]}
          onPress={() => setActiveTab('matches')}
        >
          <Text style={[styles.tabText, activeTab === 'matches' && styles.activeTabText]}>Match Jobs</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'listings' && styles.activeTab]}
          onPress={() => setActiveTab('listings')}
        >
          <Text style={[styles.tabText, activeTab === 'listings' && styles.activeTabText]}>Generated Listings</Text>
        </TouchableOpacity>
      </View>

      {renderContent()}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 50, // Adjust for status bar
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
  tabContainer: {
    paddingLeft: 5,
    paddingRight: 5,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f8f8f8',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    width: '40%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: '#93C822', // theme.colors.primary
  },
  tabText: {
    fontWeight: '600',
    color: '#333',
  },
  activeTabText: {
    color: '#fff',
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
    textTransform: 'capitalize',
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 50,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});

export default PastScansScreen;