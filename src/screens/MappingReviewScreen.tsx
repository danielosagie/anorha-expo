import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator'; // Assuming this is your stack param list
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../../lib/supabase';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card'; // Import Card component
import { useLegendState } from '../context/LegendStateContext';
import { LegendStateObservables, PlatformConnection } from '../utils/SupaLegend';

// Placeholder types for mapping suggestions - adjust based on actual API response
interface MappingSuggestionItem {
  id: string; // Platform product ID or SSSync product ID
  platformProductName?: string;
  sssyncProductName?: string;
  sku?: string;
  barcode?: string;
  matchConfidence?: 'high' | 'medium' | 'low';
  suggestedAction?: 'link' | 'create_new' | 'review_conflict';
  // Add other relevant fields from the API
  platformProductDetails?: any; // Raw details from platform
  sssyncProductDetails?: any; // Raw details from SSSync if a match
}

interface MappingSuggestions {
  perfectMatches: MappingSuggestionItem[];
  newFromPlatform: MappingSuggestionItem[];
  needsReview: MappingSuggestionItem[];
  // Add other categories if your API provides them
  summary?: {
    totalPlatformProducts: number;
    perfectMatchCount: number;
    newFromPlatformCount: number;
    needsReviewCount: number;
  }
}

type MappingReviewScreenRouteProp = RouteProp<AppStackParamList, 'MappingReview'>;
type MappingReviewScreenNavigationProp = StackNavigationProp<AppStackParamList, 'MappingReview'>;

// Base URL for your SSSync API
const SSSYNC_API_BASE_URL = 'https://api.sssync.app'; // Or your actual Railway URL

const MappingReviewScreen = () => {
  const theme = useTheme();
  const route = useRoute<MappingReviewScreenRouteProp>();
  const navigation = useNavigation<MappingReviewScreenNavigationProp>();
  const { connectionId, platformName } = route.params;
  const legendState: LegendStateObservables | null = useLegendState();

  const [suggestions, setSuggestions] = useState<MappingSuggestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<MappingSuggestions['summary'] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [multiPlatformMode, setMultiPlatformMode] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);

  // Effect to load platform connections
  useEffect(() => {
    const loadConnections = async () => {
      if (legendState?.userId) {
        try {
          const { data, error } = await supabase
            .from('PlatformConnections')
            .select('*')
            .eq('UserId', legendState.userId)
            .eq('IsEnabled', true);

          if (error) {
            console.error('[MappingReviewScreen] Error loading connections:', error);
            return;
          }

          const connections = data as PlatformConnection[];
          setPlatformConnections(connections);
          
          // Check if we have multiple platform types connected
          const platformTypes = new Set(connections.map(conn => conn.PlatformType));
          setMultiPlatformMode(platformTypes.size > 1);
          
          // Pre-select the current connection
          setSelectedConnectionIds([connectionId]);
          
        } catch (err) {
          console.error('[MappingReviewScreen] Error in loadConnections:', err);
        }
      }
    };

    loadConnections();
  }, [legendState, connectionId]);

  // --- Function to fetch mapping suggestions ---
  const fetchMappingSuggestions = useCallback(async (currentConnectionId: string) => {
    console.log(`[MappingReviewScreen] Fetching suggestions for connection: ${currentConnectionId}`);
    setLoading(true);
    setError(null);
    setSuggestions(null); // Clear previous suggestions
    setSummaryData(null); // Clear previous summary

    try {
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;

      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${currentConnectionId}/mapping-suggestions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to fetch mapping suggestions. Status: ${response.status}`);
      }

      const data: MappingSuggestions = await response.json();
      console.log('[MappingReviewScreen] Suggestions fetched successfully:', data);
      setSuggestions(data);
      setSummaryData(data.summary || null); // Set summary, defaulting to null if not present
      
    } catch (err: any) {
      console.error('[MappingReviewScreen] Error fetching mapping suggestions:', err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }, []); // No dependencies, as it uses currentConnectionId passed as arg

  useEffect(() => {
    if (connectionId) {
      fetchMappingSuggestions(connectionId);
    } else {
      setError("Connection ID is missing.");
      setLoading(false);
    }
  }, [connectionId, fetchMappingSuggestions]);
  // --- End function ---

  useEffect(() => {
    navigation.setOptions({ title: `Review ${platformName} Sync` });
  }, [navigation, platformName]);

  // Toggle selection of a connection for multi-platform sync
  const toggleConnectionSelection = (connId: string) => {
    setSelectedConnectionIds(prev => 
      prev.includes(connId) 
        ? prev.filter(id => id !== connId) 
        : [...prev, connId]
    );
  };

  // --- API-RELATED FUNCTIONS ---

  /**
   * Handles approving all perfect match links in batch
   */
  const handleApproveAllLinks = async () => {
    if (!suggestions?.perfectMatches || suggestions.perfectMatches.length === 0) {
      console.log('[MappingReviewScreen] No perfect matches to approve');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      
      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

      // Prepare payload - extract the necessary fields from perfectMatches
      const mappingsPayload = suggestions.perfectMatches.map(match => ({
        platformProductId: match.id, // Assuming this is the platform's product ID
        sssyncProductId: match.sssyncProductDetails?.id, // The SSSync product ID to link to
        action: 'link', // Action type: 'link', 'create_new', or 'ignore'
        // Include any additional fields required by your API
      }));

      console.log(`[MappingReviewScreen] Approving ${mappingsPayload.length} perfect match links for ${platformName}`);
      
      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mappings: mappingsPayload }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to confirm link mappings. Status: ${response.status}`);
      }

      const result = await response.json();
      console.log('[MappingReviewScreen] Perfect match links confirmed successfully:', result);
      
      // Success notification
      Alert.alert(
        "Links Approved", 
        `Successfully linked ${mappingsPayload.length} products.`,
        [{ text: "OK", onPress: () => fetchMappingSuggestions(connectionId) }] // Refresh data after confirmation
      );
      
    } catch (err: any) {
      console.error('[MappingReviewScreen] Error confirming perfect match links:', err);
      setError(err.message || 'An unexpected error occurred while confirming links.');
      Alert.alert("Error", err.message || "Failed to approve links. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles approving all new product creations in batch
   */
  const handleApproveAllNewCreations = async () => {
    if (!suggestions?.newFromPlatform || suggestions.newFromPlatform.length === 0) {
      console.log('[MappingReviewScreen] No new products to create');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      
      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

      // Prepare payload - extract the necessary fields from newFromPlatform
      const mappingsPayload = suggestions.newFromPlatform.map(product => ({
        platformProductId: product.id, // The platform's product ID
        action: 'create_new', // Action type: 'link', 'create_new', or 'ignore'
        // Include any additional fields required by your API
        platformProductDetails: product.platformProductDetails || {}, // Optional: Send platform details for creation
      }));

      console.log(`[MappingReviewScreen] Creating ${mappingsPayload.length} new products from ${platformName}`);
      
      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mappings: mappingsPayload }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to confirm new product creations. Status: ${response.status}`);
      }

      const result = await response.json();
      console.log('[MappingReviewScreen] New product creations confirmed successfully:', result);
      
      // Success notification
      Alert.alert(
        "New Products Approved", 
        `Successfully queued ${mappingsPayload.length} new products for creation in SSSync.`,
        [{ text: "OK", onPress: () => fetchMappingSuggestions(connectionId) }] // Refresh data after confirmation
      );
      
    } catch (err: any) {
      console.error('[MappingReviewScreen] Error confirming new product creations:', err);
      setError(err.message || 'An unexpected error occurred while creating new products.');
      Alert.alert("Error", err.message || "Failed to create new products. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles confirming individual item mappings
   */
  const handleConfirmMappings = async (mappingsToConfirm: any) => { // Type this based on actual payload
    console.log("[MappingReviewScreen] Confirming mappings:", mappingsToConfirm);
    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token) throw new Error("Authentication token not found.");

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mappings: mappingsToConfirm }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to confirm mappings. Status: ${response.status}`);
      }
      Alert.alert("Mappings Confirmed", "Selected mappings have been submitted successfully.");
      // Optionally, refresh suggestions or navigate away
      fetchMappingSuggestions(connectionId);
    } catch (err: any) {
      console.error("[MappingReviewScreen] Error confirming mappings:", err);
      setError(err.message || "An unexpected error occurred while confirming mappings.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Activates sync process for selected connections
   */
  const handleActivateSync = async () => {
    if (selectedConnectionIds.length === 0) {
      Alert.alert("Error", "Please select at least one platform to sync.");
      return;
    }

    try {
      setSyncing(true);
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      
      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

      // For each selected connection, trigger a sync
      for (const connId of selectedConnectionIds) {
        console.log(`[MappingReviewScreen] Activating sync for connection: ${connId}`);
        
        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connId}/activate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
          throw new Error(errorData.message || `Failed to activate sync for connection. Status: ${response.status}`);
        }

        console.log(`[MappingReviewScreen] Sync activated successfully for connection: ${connId}`);
      }

      // Success notification
      Alert.alert(
        "Sync Activated", 
        `Successfully activated sync for ${selectedConnectionIds.length} platform${selectedConnectionIds.length > 1 ? 's' : ''}.`,
        [{ text: "OK", onPress: () => navigation.goBack() }] // Return to previous screen after successful sync
      );
      
    } catch (err: any) {
      console.error('[MappingReviewScreen] Error activating sync:', err);
      Alert.alert("Error", err.message || "Failed to activate sync. Please try again later.");
    } finally {
      setSyncing(false);
    }
  };

  // --- END API-RELATED FUNCTIONS ---

  const handleReviewItem = (item: MappingSuggestionItem) => {
    Alert.alert("Review Item", `Reviewing: ${item.platformProductName || item.sssyncProductName} (Not implemented)`);
    // Navigate to a detailed review screen or show a modal
  };

  const renderSuggestionItem = ({ item }: { item: MappingSuggestionItem }) => (
    <Card style={styles.suggestionCard}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemTitle}>{item.platformProductName || item.sssyncProductName || 'Unnamed Product'}</Text>
        {item.matchConfidence && (
          <View style={[styles.confidenceBadge, styles[`confidence_${item.matchConfidence}`]]}>
            <Text style={styles.confidenceText}>{item.matchConfidence.toUpperCase()}</Text>
          </View>
        )}
      </View>
      <Text style={styles.itemSku}>SKU: {item.sku || 'N/A'}</Text>
      {/* TODO: Show more details, like images, prices, SSSync product if matched etc. */}
      <View style={styles.itemActions}>
        {/* TODO: Implement actions based on item.suggestedAction */}
        <Button title="Details" onPress={() => handleReviewItem(item)} style={styles.actionButton} />
        {item.suggestedAction === 'link' && 
          <Button 
            title="Link" 
            onPress={() => Alert.alert("Link", "Link action not implemented")} 
            style={StyleSheet.flatten([styles.actionButton, styles.linkButton])}
          />}
        {item.suggestedAction === 'create_new' && 
          <Button 
            title="Create New" 
            onPress={() => Alert.alert("Create", "Create action not implemented")} 
            style={StyleSheet.flatten([styles.actionButton, styles.createButton])}
          />}
      </View>
    </Card>
  );

  const renderConnectionItem = (connection: PlatformConnection) => {
    const isSelected = selectedConnectionIds.includes(connection.Id);
    const isCurrentConnection = connection.Id === connectionId;
    
    return (
      <TouchableOpacity 
        key={connection.Id}
        style={[
          styles.connectionItem,
          isSelected && styles.connectionItemSelected,
          isCurrentConnection && styles.connectionItemCurrent
        ]}
        onPress={() => toggleConnectionSelection(connection.Id)}
      >
        <View style={styles.connectionItemContent}>
          <Icon 
            name={getIconForPlatformType(connection.PlatformType)} 
            size={24} 
            color={isSelected ? theme.colors.primary : theme.colors.textSecondary} 
          />
          <View style={styles.connectionTextContainer}>
            <Text style={[
              styles.connectionName,
              isSelected && {color: theme.colors.primary}
            ]}>
              {connection.DisplayName}
            </Text>
            <Text style={styles.connectionPlatformType}>{connection.PlatformType}</Text>
          </View>
        </View>
        <Icon 
          name={isSelected ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} 
          size={22} 
          color={isSelected ? theme.colors.primary : theme.colors.textSecondary} 
        />
      </TouchableOpacity>
    );
  };

  const getIconForPlatformType = (platformType: string): string => {
    const type = platformType.toLowerCase();
    if (type.includes('shopify')) return 'shopping';
    if (type.includes('square')) return 'square-medium';
    if (type.includes('clover')) return 'clover';
    if (type.includes('amazon')) return 'amazon';
    if (type.includes('ebay')) return 'tag';
    if (type.includes('facebook')) return 'facebook';
    return 'store';
  };

  // Moved StyleSheet.create inside the component to access theme
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      backgroundColor: theme.colors.background, 
    },
    loadingText: {
      marginTop: 10,
      fontSize: 16,
      color: theme.colors.textSecondary,
    },
    errorText: {
      marginTop: 10,
      fontSize: 16,
      color: theme.colors.error, 
      textAlign: 'center',
      marginBottom:15,
    },
    emptyText: {
      marginTop: 10,
      fontSize: 16,
      color: theme.colors.textSecondary, 
      textAlign: 'center',
      marginBottom: 15,
    },
    headerContainer: {
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: '#ddd', 
      backgroundColor: theme.colors.surface, 
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 5,
    },
    platformText: {
      fontSize: 18,
      color: theme.colors.primary,
      marginBottom: 10,
    },
    summaryContainer: {
      flexDirection: 'column',
      marginBottom: 10,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginVertical: 5,
    },
    summaryItem: {
      alignItems: 'center',
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.surface,
      minWidth: 100,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    summaryCount: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    summaryLabel: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 4,
    },
    batchActionsContainer: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      flexDirection: 'column',
      borderBottomWidth: 1,
      borderBottomColor: '#ddd', 
      backgroundColor: theme.colors.surface, 
      gap: 10,
    },
    batchButton: {
      width: '100%', 
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 10,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface, 
    },
    suggestionList: {
      paddingHorizontal: 15,
    },
    suggestionCard: {
      marginBottom: 15,
      padding: 15,
    },
    itemHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    itemTitle: {
      fontSize: 16,
      fontWeight: '500',
      flex: 1, 
      color: theme.colors.text,
    },
    itemSku: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginBottom: 10,
    },
    confidenceBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      marginLeft: 10, 
    },
    confidence_high: { backgroundColor: theme.colors.success + '30' }, 
    confidence_medium: { backgroundColor: theme.colors.warning + '30' }, 
    confidence_low: { backgroundColor: theme.colors.error + '30' }, 
    confidenceText: {
      fontSize: 10,
      fontWeight: 'bold',
      color: theme.colors.text, 
    },
    itemActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 10,
    },
    needsReviewSection: {
      padding: 20,
    },
    placeholderText: {
      fontStyle: 'italic',
      textAlign: 'center',
      paddingVertical: 20,
      color: theme.colors.textSecondary, 
    },
    footerActions: {
      padding: 20,
      borderTopWidth: 1,
      borderTopColor: '#ddd', 
      marginTop: 20,
    },
    actionButton: {
      paddingHorizontal: 12,
      paddingVertical: 6, 
      marginLeft: 10,
    },
    linkButton: {
      backgroundColor: theme.colors.success + '20', 
    },
    createButton: {
      backgroundColor: theme.colors.secondary + '20', 
    },
    // New styles for connections
    connectionsContainer: {
      backgroundColor: theme.colors.surface,
      padding: 15,
      marginVertical: 10,
      borderRadius: 8,
      marginHorizontal: 15,
    },
    connectionsTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 10,
      color: theme.colors.text,
    },
    connectionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0',
    },
    connectionItemSelected: {
      backgroundColor: theme.colors.primary + '10',
    },
    connectionItemCurrent: {
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.primary,
    },
    connectionItemContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    connectionTextContainer: {
      marginLeft: 10,
    },
    connectionName: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text,
    },
    connectionPlatformType: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    syncButtonContainer: {
      padding: 15,
      backgroundColor: theme.colors.surface,
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      borderTopWidth: 1,
      borderTopColor: '#f0f0f0',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 5,
    }
  });

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.text }]}>Loading {platformName} Suggestions...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Icon name="alert-circle-outline" size={48} color={theme.colors.error} />
        <Text style={[styles.errorText, { color: theme.colors.error }]}>Error: {error}</Text>
        <Button title="Retry" onPress={() => fetchMappingSuggestions(connectionId)} />
      </View>
    );
  }

  if (!suggestions) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Icon name="information-outline" size={48} color={theme.colors.textSecondary} />
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>No mapping suggestions found for {platformName}.</Text>
        <Button title="Refresh" onPress={() => fetchMappingSuggestions(connectionId)} />
      </View>
    );
  }
  
  // Basic rendering of suggestion counts
  const summary = suggestions.summary;
  const hasBatchActions = (suggestions?.perfectMatches && suggestions.perfectMatches.length > 0) || 
                          (suggestions?.newFromPlatform && suggestions.newFromPlatform.length > 0);
  const hasItemsNeedingReview = suggestions?.needsReview && suggestions.needsReview.length > 0;
  const showSyncButton = multiPlatformMode || hasBatchActions || hasItemsNeedingReview;
  
  // Determine if we can show the multi-platform sync options
  const otherConnections = platformConnections.filter(conn => conn.Id !== connectionId);
  const showMultiPlatformOptions = otherConnections.length > 0;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: showSyncButton ? 80 : 20 }}>
        <View style={styles.headerContainer}>
          <Text style={styles.title}>Review Sync</Text>
          <Text style={styles.platformText}>{platformName}</Text>
          {summaryData && (
            <View style={styles.summaryContainer}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryCount}>{summaryData.perfectMatchCount || 0}</Text>
                  <Text style={styles.summaryLabel}>Perfect Matches</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryCount}>{summaryData.newFromPlatformCount || 0}</Text>
                  <Text style={styles.summaryLabel}>New from Platform</Text>
                </View>
              </View>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryCount}>{summaryData.needsReviewCount || 0}</Text>
                  <Text style={styles.summaryLabel}>Needs Review</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryCount}>{summaryData.totalPlatformProducts || 0}</Text>
                  <Text style={styles.summaryLabel}>Total Products</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {hasBatchActions && (
          <View style={styles.batchActionsContainer}>
            {suggestions?.perfectMatches && suggestions.perfectMatches.length > 0 && (
              <Button
                title={`Approve ${suggestions.perfectMatches.length} Perfect Links`}
                onPress={handleApproveAllLinks}
                style={styles.batchButton}
                icon="link-variant"
              />
            )}
            {suggestions?.newFromPlatform && suggestions.newFromPlatform.length > 0 && (
              <Button
                title={`Create ${suggestions.newFromPlatform.length} New in SSSync`}
                onPress={handleApproveAllNewCreations}
                style={StyleSheet.flatten([styles.batchButton, {backgroundColor: theme.colors.secondary + '20'}])}
                icon="plus-circle-outline"
              />
            )}
          </View>
        )}

        {hasItemsNeedingReview && (
          <>
            <Text style={styles.sectionTitle}>Items Needing Review ({suggestions.needsReview.length})</Text>
            <View style={styles.suggestionList}>
              {suggestions.needsReview.map(item => renderSuggestionItem({ item }))}
            </View>
          </>
        )}

        {!hasBatchActions && !hasItemsNeedingReview && !loading && !error && (
          <View style={styles.centered}>
              <Icon name="information-outline" size={48} color={theme.colors.textSecondary} />
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>No mapping suggestions found for {platformName}.</Text>
              <Button title="Refresh" onPress={() => fetchMappingSuggestions(connectionId)} />
          </View>
        )}

        {/* Multi-platform selection section */}
        {showMultiPlatformOptions && (
          <View style={styles.connectionsContainer}>
            <Text style={styles.connectionsTitle}>Select Platforms to Sync</Text>
            {platformConnections.map(renderConnectionItem)}
          </View>
        )}
      </ScrollView>

      {/* Fixed Sync Button at bottom */}
      {showSyncButton && (
        <View style={styles.syncButtonContainer}>
          <Button 
            title={syncing ? "Syncing..." : "Activate Sync"}
            onPress={handleActivateSync}
            disabled={syncing || selectedConnectionIds.length === 0}
            loading={syncing}
            icon="sync"
          />
        </View>
      )}
    </View>
  );
};

export default MappingReviewScreen;
