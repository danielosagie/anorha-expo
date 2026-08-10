import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformButton from './PlatformButton';
import { ENABLED_PLATFORMS } from '../config/platforms';

// BottomNav renders exactly one surface today: the platform picker overlay
// (App.tsx passes the literal 'platformPicker'). The old generate-flow states
// (empty/selection/template/platform/match_confirm/match_assist_input) had no
// reachable render site and were removed in the teardown sweep.
export type BottomNavState = 'platformPicker';

type Props = {
  state: BottomNavState;
  isConnected: (platform: string) => boolean;
  platformActiveCounts?: Record<string, number>;
  onStartConnect?: (platform: string) => void;
  /** "See all platforms" → the full connect page. The row only renders when a
   *  host provides this — hosts without navigation simply don't get the row,
   *  so the platform-key channel never carries sentinel values. */
  onSeeAll?: () => void;
  style?: StyleProp<ViewStyle>;
};

const BottomNav: React.FC<Props> = ({
  state,
  isConnected,
  platformActiveCounts = {},
  onStartConnect,
  onSeeAll,
  style,
}) => {
  return (
    <LinearGradient
      colors={["rgba(255, 255, 255, 0)", "rgb(255, 255, 255)", "rgb(255, 255, 255)"]}
      style={[
        {
          marginBottom: 0,
          width: '100%',
          alignSelf: 'stretch',
        },
        style
      ]}
    >
      {state === 'platformPicker' && (
        <View style={styles.platformPickerContainer}>
          <View style={styles.platformHeader}>
            <Text style={styles.platformHeaderText}>Which Platform To Add?</Text>
            <View style={{ width: 24 }} />
          </View>
          <View style={styles.platformGrid}>
            {ENABLED_PLATFORMS.map((p) => (
              <PlatformButton
                key={p}
                platform={p}
                isSelected={false}
                onPress={() => onStartConnect && onStartConnect(p)}
                isConnected={isConnected(p)}
                activeCount={platformActiveCounts[p] || 0}
              />
            ))}
          </View>
          {/* See all platforms → full connect page (Shopify, Square, Clover,
              eBay, Facebook + coming-soon). Renders only when the host wires
              onSeeAll — no sentinel through the platform-key channel. */}
          {onSeeAll ? (
            <TouchableOpacity style={styles.seeAllButton} onPress={onSeeAll}>
              <Icon name="apps" size={20} color="#3F3F46" />
              <Text style={styles.seeAllText}>See all platforms</Text>
              <Icon name="chevron-right" size={20} color="#C4C8CE" style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          ) : null}
          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', marginVertical: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: '#e5e7eb' }} />
            <Text style={{ marginHorizontal: 12, color: '#9ca3af', fontSize: 13 }}>OR</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: '#e5e7eb' }} />
          </View>
          {/* CSV Import Button */}
          <TouchableOpacity
            style={styles.csvImportButton}
            onPress={() => onStartConnect && onStartConnect('csv')}
          >
            <Icon name="table" size={20} color="#6b7280" />
            <Text style={styles.csvImportText}>Import from CSV</Text>
          </TouchableOpacity>
        </View>
      )}
    </LinearGradient>
  );
};

export default BottomNav;

const styles = StyleSheet.create({
  platformPickerContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 20,
    justifyContent: 'flex-start',
    marginTop: 10,
    backgroundColor: 'rgb(255, 255, 255)',
    paddingBottom: 24,
  },
  platformHeader: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '100%',
    marginBottom: 12,
    marginTop: 16
  },
  platformHeaderText: {
    fontSize: 24,
    fontWeight: '500',
    color: '#000'
  },
  platformGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 8
  },
  csvImportButton: {
    minWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    gap: 8,
  },
  csvImportText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#374151',
  },
  seeAllButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 4,
  },
  seeAllText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#18181B',
  },
});
