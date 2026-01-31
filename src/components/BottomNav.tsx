import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformButton from './PlatformButton';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';



export type BottomNavState = 'empty' | 'selection' | 'template' | 'platform' | 'platformPicker';

type Props = {
  state: BottomNavState;
  selectedCount: number;
  selectedTemplate: string | null;
  selectedPlatforms: string[];
  isConnected: (platform: string) => boolean;
  platformActiveCounts?: Record<string, number>;
  onShowSelection: () => void;
  onShowTemplates: () => void;
  onBackToEmpty: () => void;
  onBackToSelection: () => void;
  onOpenTemplateModal: () => void;
  onTemplateSelect: (template: string | null) => void;
  onPlatformToggle: (platform: string) => void;
  onBack?: () => void;
  onGeneratePress: () => void;
  onStartConnect?: (platform: string) => void;
  style?: StyleProp<ViewStyle>;
};

const BottomNav: React.FC<Props> = ({
  state,
  selectedCount,
  selectedTemplate,
  selectedPlatforms,
  isConnected,
  platformActiveCounts = {},
  onShowSelection,
  onShowTemplates,
  onBackToEmpty,
  onBackToSelection,
  onOpenTemplateModal,
  onTemplateSelect,
  onPlatformToggle,
  onBack,
  onGeneratePress,
  onStartConnect,
  style,
}) => {
  return (
    <LinearGradient
      colors={["rgba(255, 255, 255, 0)", "rgb(255, 255, 255)", "rgb(255, 255, 255)"]}
      style={[
        {
          marginBottom: 3,
          ...(state === 'platformPicker' ? { flex: 1, width: '100%' } : {}),
        },
        style
      ]}
    >
      {state === 'empty' && (
        <View style={styles.emptyButtonSolo}>
          <TouchableOpacity style={styles.mainEmptyButton}>
            <Icon name="cursor-default-click" size={20} color="#000" style={{ marginRight: 8 }} />
            <Text style={styles.secondaryButtonText}>Select product matches</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'selection' && selectedCount > 0 && (
        <View style={styles.emptyButtonSolo}>
          <TouchableOpacity style={styles.mainButton} onPress={onShowTemplates}>
            <Icon name="check-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.mainButtonText}>Selected {selectedCount} Match{selectedCount !== 1 ? 'es' : ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={onBackToEmpty}>
            <Text style={styles.backButtonText}>Clear Selection</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'template' && (
        <View style={styles.bottomNavStepContainer}>
          <TouchableOpacity style={styles.clearBackButton} onPress={onBackToSelection}>
            <Icon name="redo-variant" size={20} color="#888" style={{ marginRight: 8 }} />
            <Text style={styles.backButtonText}>Reselect Matches</Text>
          </TouchableOpacity>
          <Text style={styles.platformHeaderText}>Want Specific Sources?</Text>
          <TouchableOpacity style={styles.dropdownSelect} onPress={onOpenTemplateModal}>
            <Text style={styles.dropdownSelectText}>{selectedTemplate ? selectedTemplate : 'Select a Template'}</Text>
            <Icon name="chevron-down" size={20} color="#000" style={{ marginRight: 8 }} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onTemplateSelect(null)}>
            <Text style={styles.secondaryButtonText}>Continue w/o Template</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'platform' && (
        <View style={styles.expandedBottomNav}>
          <View style={{ flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity style={styles.clearBackButton} onPress={onBackToSelection}>
              <Icon name="redo-variant" size={20} color="#888" style={{ marginRight: 8 }} />
              <Text style={styles.backButtonText}>Reselect Matches</Text>
            </TouchableOpacity>
            <Text style={styles.platformHeaderText}>Want Specific Sources?</Text>
            <TouchableOpacity style={styles.dropdownSelect} onPress={onOpenTemplateModal}>
              <Text style={styles.dropdownSelectText}>
                {selectedTemplate ? selectedTemplate : 'Select a Template'}
              </Text>
              <Icon name="chevron-down" size={20} color="#000" style={{ marginRight: 8 }} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <View style={styles.platformHeader}>
              <Text style={styles.platformHeaderText}>Which Platforms?</Text>
              <View style={{ width: 24 }} />
            </View>
            <View style={styles.platformGrid}>
              <PlatformButton
                platform={'shopify'}
                isSelected={selectedPlatforms.includes('shopify')}
                onPress={() => onPlatformToggle('shopify')}
                isConnected={isConnected('shopify')}
              />
              <PlatformButton
                platform={'amazon'}
                isSelected={selectedPlatforms.includes('amazon')}
                onPress={() => onPlatformToggle('amazon')}
                isConnected={isConnected('amazon')}
              />
              <PlatformButton
                platform={'ebay'}
                isSelected={selectedPlatforms.includes('ebay')}
                onPress={() => onPlatformToggle('ebay')}
                isConnected={isConnected('ebay')}
              />
              <PlatformButton
                platform={'clover'}
                isSelected={selectedPlatforms.includes('clover')}
                onPress={() => onPlatformToggle('clover')}
                isConnected={isConnected('clover')}
              />
              <PlatformButton
                platform={'square'}
                isSelected={selectedPlatforms.includes('square')}
                onPress={() => onPlatformToggle('square')}
                isConnected={isConnected('square')}
              />
              <PlatformButton
                platform={'facebook'}
                isSelected={selectedPlatforms.includes('facebook')}
                onPress={() => onPlatformToggle('facebook')}
                isConnected={isConnected('facebook')}
              />
            </View>
            <TouchableOpacity
              style={[styles.mainButton, selectedPlatforms.length === 0 && styles.disabledButton]}
              disabled={selectedPlatforms.length === 0}
              onPress={onGeneratePress}
            >
              <Icon name="rocket-launch-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.mainButtonText}>Generate Listings ({selectedPlatforms.length} platform{selectedPlatforms.length !== 1 ? 's' : ''})</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {state === 'platformPicker' && (
        <View style={styles.platformPickerContainer}>
          <View style={styles.platformHeader}>
            <Text style={styles.platformHeaderText}>Which Platform To Add?</Text>
            <View style={{ width: 24 }} />
          </View>
          <View style={styles.platformGrid}>
            {['shopify', 'square', 'clover', 'ebay', 'facebook'].map((p) => (
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
  expandedBottomNav: {
    alignItems: 'center',
    paddingLeft: 30,
    paddingRight: 30,
    justifyContent: 'space-between',
    marginTop: 10,
    minHeight: 550,
    maxHeight: 950,
    backgroundColor: 'rgb(255, 255, 255)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
  },
  platformPickerContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 20,
    justifyContent: 'center',
    marginTop: 10,
    flex: 1,
    backgroundColor: 'rgb(255, 255, 255)'
  },
  bottomNavStepContainer: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 30,
    paddingTop: 20,
    marginTop: 10,
    minHeight: 100,
    backgroundColor: 'rgb(255, 255, 255)',
    paddingBottom: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  emptyButtonSolo: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    minHeight: 100,
    maxHeight: 150,
    marginHorizontal: 30,
    backgroundColor: "rgba(255, 255, 255, 0)",
  },
  mainEmptyButton: {
    width: '100%',
    justifyContent: "center",
    borderStyle: 'dashed',
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 210, 97, 0.5)',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 12,
  },
  mainButton: {
    flexDirection: 'row',
    backgroundColor: '#93C822',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%'
  },
  mainButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    marginTop: 12,
    flexDirection: 'row',
    backgroundColor: '#D9D9D9',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%'
  },
  secondaryButtonText: { color: '#888', fontSize: 16, fontWeight: '500' },
  clearBackButton: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    paddingVertical: 7,
    borderRadius: 12,
  },
  backButton: {
    flexDirection: 'row',
    backgroundColor: '#D9D9D9',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%'
  },
  backButtonText: { color: '#888', fontSize: 16, fontWeight: '600' },
  disabledButton: { backgroundColor: '#555' },
  dropdownSelect: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 15,
    marginLeft: 10,
    marginRight: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%'
  },
  dropdownSelectText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000'
  },
  platformHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 12
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
});


