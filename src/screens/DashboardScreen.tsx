import React, { useMemo, useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import Card from '../components/Card';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LegendStateContext } from '../context/LegendStateContext';
import { supabase } from '../../lib/supabase';

const DashboardScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const legendCtx = useContext(LegendStateContext);
  
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // 1. Compute Live Inventory Stats (Low Stock, Total)
  const stats = useMemo(() => {
    const pv = legendCtx?.productVariants$?.get?.() || {};
    const levels = legendCtx?.inventoryLevels$?.get?.() || {};
    
    let totalInventory = 0;
    const variantQuantities: Record<string, number> = {};
    
    Object.values(levels).forEach((level: any) => {
        const qty = level.Quantity || 0;
        totalInventory += qty;
        const vid = level.ProductVariantId;
        if (vid) {
            variantQuantities[vid] = (variantQuantities[vid] || 0) + qty;
        }
    });

    const lowStockThreshold = 5;
    const lowStockItems = Object.keys(variantQuantities)
        .filter(vid => variantQuantities[vid] <= lowStockThreshold)
        .map(vid => ({
            id: vid,
            title: pv[vid]?.Title || 'Unknown Product',
            quantity: variantQuantities[vid],
            sku: pv[vid]?.Sku
        }))
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 3); // Top 3

    return { 
        totalInventory, 
        lowStockItems,
        lowStockCount: Object.keys(variantQuantities).filter(vid => variantQuantities[vid] <= lowStockThreshold).length
    };
  }, [legendCtx?.productVariants$, legendCtx?.inventoryLevels$]);

  // 2. Fetch Recent Activity
  useEffect(() => {
    const fetchActivity = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      try {
        const response = await fetch('https://api.sssync.app/api/activity?limit=3', {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const json = await response.json();
        if (json.events) {
          setRecentActivity(json.events);
        }
      } catch (e) {
        console.error('Failed to fetch dashboard activity', e);
      } finally {
        setLoadingActivity(false);
      }
    };
    
    fetchActivity();
  }, []);

  // 3. Fetch Last Sync Time
  useEffect(() => {
    const fetchLastSync = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('PlatformConnections')
        .select('LastSyncSuccessAt')
        .eq('UserId', user.id)
        .order('LastSyncSuccessAt', { ascending: false })
        .limit(1);

      if (data && data.length > 0 && data[0].LastSyncSuccessAt) {
        setLastSyncTime(data[0].LastSyncSuccessAt);
      }
    };
    fetchLastSync();
  }, []);

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} minutes ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${Math.floor(diffHours / 24)} days ago`;
  };

  if (!legendCtx) {
    return (
      <View style={[styles.fullScreenContainer, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.fullScreenContainer, { paddingTop: 60 }]}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.delay(100).duration(500)}>
          
          {/* Search Entry */}
          <View style={styles.searchContainer}>
            <TouchableOpacity 
              style={styles.searchBar}
              onPress={() => navigation.navigate('Inventory', { initialSearch: '', initialSortBy: 'name' })}
              activeOpacity={0.9}
            >
              <Icon name="magnify" size={20} color="#999" style={styles.searchIcon} />
              <Text style={[styles.searchInput, { color: '#999' }]}>
                Search inventory...
              </Text>
              <TouchableOpacity 
                style={styles.scannerButton}
                onPress={() => navigation.navigate('Inventory', { openScannerOnMount: true })}
              >
                <Icon name="qrcode-scan" size={20} color="#fff" />
              </TouchableOpacity>
            </TouchableOpacity>
          </View>

          {/* Low Stock Alert */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <Icon name="alert-circle-outline" size={20} color="#F59E0B" style={{marginRight: 8}} />
                <Text style={styles.cardTitle}>
                  Low Stock ({stats.lowStockCount})
                </Text>
              </View>
            </View>

            {stats.lowStockItems.length === 0 ? (
               <View style={styles.emptyState}>
                 <Icon name="check-circle-outline" size={32} color={theme.colors.success} />
                 <Text style={[styles.emptyStateText, {marginTop: 8}]}>All stocked up!</Text>
               </View>
            ) : (
              stats.lowStockItems.map((item) => (
                <TouchableOpacity 
                  key={item.id} 
                  style={styles.listItem}
                  onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                >
                  <View>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.itemSubtitle}>{item.quantity} units • Reorder soon</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color="#CCC" />
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity 
              style={styles.viewAllButton}
              onPress={() => navigation.navigate('Inventory', { initialSortBy: 'stock-low', lowStockOnly: true })}
            >
              <Text style={[styles.viewAllText, { color: theme.colors.primary }]}>View all low stock</Text>
            </TouchableOpacity>
          </Card>

          {/* Recent Activity */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <Icon name="history" size={20} color={theme.colors.primary} style={{marginRight: 8}} />
                <Text style={styles.cardTitle}>Recent Activity</Text>
              </View>
            </View>

            {loadingActivity ? (
              <ActivityIndicator size="small" color={theme.colors.primary} style={{margin: 20}} />
            ) : recentActivity.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No recent activity</Text>
              </View>
            ) : (
              recentActivity.map((event: any) => (
                <TouchableOpacity 
                  key={event.Id} 
                  style={styles.listItem}
                  onPress={() => event.ProductVariantId && navigation.navigate('ProductDetail', { productId: event.ProductVariantId })}
                  disabled={!event.ProductVariantId}
                >
                  <View style={{flex: 1}}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{event.Message}</Text>
                    <Text style={styles.itemSubtitle}>
                      {formatTimeAgo(event.Timestamp)} • {event.Details?.platform || 'System'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity 
              style={styles.viewAllButton}
              onPress={() => navigation.navigate('ActivityFeed')}
            >
              <Text style={[styles.viewAllText, { color: theme.colors.primary }]}>View all activity</Text>
            </TouchableOpacity>
          </Card>

          {/* Quick Actions */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
          </View>
          
          <View style={styles.quickActionsGrid}>
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('Inventory', { openScannerOnMount: true })}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#E0F2FE' }]}>
                <Icon name="camera-outline" size={24} color="#0284C7" />
              </View>
              <Text style={styles.actionLabel}>Scan Product</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('Inventory', { initialSortBy: 'date' })} 
            >
              <View style={[styles.actionIcon, { backgroundColor: '#DCFCE7' }]}>
                <Icon name="plus" size={24} color="#16A34A" />
              </View>
              <Text style={styles.actionLabel}>Log Sale</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('Inventory', { initialSortBy: 'stock-high' })}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#F3E8FF' }]}>
                <Icon name="chart-bar" size={24} color="#9333EA" />
              </View>
              <Text style={styles.actionLabel}>View by Pool</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('Inventory', { openLocationPicker: true })}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#FFEDD5' }]}>
                <Icon name="map-marker-outline" size={24} color="#EA580C" />
              </View>
              <Text style={styles.actionLabel}>By Location</Text>
            </TouchableOpacity>
          </View>

          {/* Footer Stats */}
          <View style={styles.footerStats}>
            <Text style={styles.footerStatText}>Total Inventory: {stats.totalInventory.toLocaleString()} units</Text>
            {lastSyncTime && (
              <Text style={styles.footerStatSubtext}>Last sync: {formatTimeAgo(lastSyncTime)}</Text>
            )}
            
            <View style={styles.footerLinks}>
              <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
                <Text style={styles.footerLink}>Settings</Text>
              </TouchableOpacity>
              <Text style={styles.footerLinkDivider}>•</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
                <Text style={styles.footerLink}>Support</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{height: 100}} /> 
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1, 
    backgroundColor: '#F8F9FB',
  },
  container: {
    flex: 1,
    padding: 16,
  },
  searchContainer: {
    marginBottom: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingTop: 0, // Center text vertically
  },
  scannerButton: {
    backgroundColor: '#93C822',
    padding: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  card: {
    marginBottom: 16,
    padding: 0, // Reset padding for list items
    overflow: 'hidden',
  },
  cardHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
  },
  listItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1F2937',
    marginBottom: 4,
  },
  itemSubtitle: {
    fontSize: 13,
    color: '#6B7280',
  },
  viewAllButton: {
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#6B7280',
    fontSize: 14,
  },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  actionButton: {
    width: '48%',
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  footerStats: {
    alignItems: 'center',
    marginBottom: 20,
  },
  footerStatText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  footerStatSubtext: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 12,
  },
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerLink: {
    fontSize: 12,
    color: '#6B7280',
    padding: 8,
  },
  footerLinkDivider: {
    fontSize: 12,
    color: '#D1D5DB',
  },
});

export default DashboardScreen;