import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, StyleProp, ViewStyle, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformButton from './PlatformButton';
import { SmartCommandInput } from './SmartCommandInput';
import { ENABLED_PLATFORMS } from '../config/platforms';



export type BottomNavState = 'empty' | 'selection' | 'template' | 'platform' | 'platformPicker' | 'match_confirm' | 'match_assist_input';

type Props = {
  state: BottomNavState;
  selectedCount: number;
  selectedTemplate: string | null;
  selectedPlatforms: string[];
  isConnected: (platform: string) => boolean;
  platformActiveCounts?: Record<string, number>;
  /** When > 1, show "Platforms apply to all N items" so user knows selection is batch-level */
  totalItemsCount?: number;
  /** When in selection state, show this as confirmed product (expandable); tap "Change match" to reselect */
  confirmedProduct?: { thumb?: string; title?: string; price?: string; condition?: string; source?: string } | null;
  onChangeMatch?: () => void;
  onShowSelection: () => void;
  onShowTemplates: () => void;
  onShowPlatforms: () => void;
  onBackToEmpty: () => void;
  onBackToSelection: () => void;
  onOpenTemplateModal: () => void;
  onTemplateSelect: (template: string | null) => void;
  onPlatformToggle: (platform: string) => void;
  onBack?: () => void;
  onGeneratePress: () => void;
  onStartConnect?: (platform: string) => void;
  style?: StyleProp<ViewStyle>;
  manualOverrideInput?: string;
  onManualOverrideChange?: (text: string) => void;
  onManualOverrideApply?: () => void;
  // Match selection footer mode props
  matchSelectedItem?: { thumb?: string; title?: string; source?: string } | null;
  matchPrompt?: string;
  matchInputValue?: string;
  onMatchInputChange?: (value: string) => void;
  onMatchConfirm?: () => void;
  onMatchDeny?: () => void;
  onMatchSubmitDetails?: (text: string) => void;
  onMatchBestGuess?: () => void;
  onMatchReselect?: () => void;
  matchSubmitting?: boolean;
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
  onShowPlatforms,
  onBackToEmpty,
  onBackToSelection,
  onOpenTemplateModal,
  onTemplateSelect,
  onPlatformToggle,
  onBack,
  onGeneratePress,
  onStartConnect,
  style,
  totalItemsCount = 1,
  confirmedProduct = null,
  onChangeMatch,
  manualOverrideInput = '',
  onManualOverrideChange,
  onManualOverrideApply,
  matchSelectedItem = null,
  matchPrompt,
  matchInputValue = '',
  onMatchInputChange,
  onMatchConfirm,
  onMatchDeny,
  onMatchSubmitDetails,
  onMatchBestGuess,
  onMatchReselect,
  matchSubmitting = false,
}) => {
  const [confirmedExpanded, setConfirmedExpanded] = React.useState(false);
  const matchInputLabel = 'e.g. barcode, model number, visible text';

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
          <TouchableOpacity style={styles.mainButton} onPress={onShowPlatforms}>
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
            <Text style={styles.dropdownSelectText}>{selectedTemplate ? selectedTemplate : 'Select a Source Template'}</Text>
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
            {confirmedProduct?.title ? (
              <View style={{ flexDirection: "column", backgroundColor: 'rgba(154, 154, 154, 0.12)', gap: 6, marginTop: 18, marginBottom: 18, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 }}>
                <Text style={styles.platformSubheaderText}>Selected Item:</Text>
                <TouchableOpacity
                  onPress={() => setConfirmedExpanded(e => !e)}
                  style={{ flexDirection: 'row', alignItems: 'center', width: '100%', paddingVertical: 8, borderRadius: 10 }}
                >
                  {confirmedProduct.thumb ? (
                    <Image source={{ uri: confirmedProduct.thumb }} style={{ width: 44, height: 44, borderRadius: 6, marginRight: 10 }} resizeMode="cover" />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#111' }} numberOfLines={2}>{confirmedProduct.title}</Text>
                    {confirmedExpanded && (confirmedProduct.price != null || confirmedProduct.condition != null || confirmedProduct.source != null) && (
                      <View style={{ marginTop: 6 }}>
                        {confirmedProduct.price != null && <Text style={{ fontSize: 12, color: '#374151' }}>Price: {confirmedProduct.price}</Text>}
                        {confirmedProduct.condition != null && <Text style={{ fontSize: 12, color: '#374151' }}>Condition: {confirmedProduct.condition}</Text>}
                        {confirmedProduct.source != null && <Text style={{ fontSize: 12, color: '#374151' }}>Source: {confirmedProduct.source}</Text>}
                      </View>
                    )}
                  </View>
                  <Icon name={confirmedExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#6b7280" />
                </TouchableOpacity>
              </View>
            ) : null}

            {onManualOverrideChange && onManualOverrideApply && (
              <View style={styles.manualSafetyWrap}>
                <Text style={styles.manualSafetyLabel}>Safety override: paste a product URL or type the product name</Text>
                <View style={styles.manualSafetyRow}>
                  <TextInput
                    value={manualOverrideInput}
                    onChangeText={onManualOverrideChange}
                    placeholder="https://example.com/item or Logitech G502"
                    placeholderTextColor="#999"
                    style={styles.manualSafetyInput}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={[styles.manualSafetyButton, manualOverrideInput.trim().length === 0 && { opacity: 0.5 }]}
                    disabled={manualOverrideInput.trim().length === 0}
                    onPress={onManualOverrideApply}
                  >
                    <Text style={styles.manualSafetyButtonText}>Override</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <Text style={styles.platformHeaderText}>Want Specific Sources?</Text>
            <TouchableOpacity style={styles.dropdownSelect} onPress={onOpenTemplateModal}>
              <Text style={styles.dropdownSelectText}>
                {selectedTemplate ? selectedTemplate : 'Select a Source Template'}
              </Text>
              <Icon name="chevron-down" size={20} color="#000" style={{ marginRight: 8 }} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <View style={styles.platformHeader}>
              <Text style={styles.platformHeaderText}>Which Platforms?</Text>
              {totalItemsCount > 1 && (
                <Text style={styles.platformForAllLabel}>Apply to all {totalItemsCount} items</Text>
              )}
            </View>
            <View style={styles.platformGrid}>
              {ENABLED_PLATFORMS.map((p) => (
                <PlatformButton
                  key={p}
                  platform={p}
                  isSelected={selectedPlatforms.includes(p)}
                  onPress={() => onPlatformToggle(p)}
                  isConnected={isConnected(p)}
                />
              ))}
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

      {state === 'match_confirm' && (
        <View style={styles.matchFooterWrap}>
          <Text style={styles.matchHeader}>Selected Match</Text>
          <View style={styles.matchSelectedCard}>
            {matchSelectedItem?.thumb ? (
              <Image source={{ uri: matchSelectedItem.thumb }} style={styles.matchSelectedThumb} resizeMode="cover" />
            ) : (
              <View style={styles.matchSelectedThumbPlaceholder} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.matchSelectedTitle} numberOfLines={2}>
                {matchSelectedItem?.title || 'Untitled listing'}
              </Text>
              <Text style={styles.matchSelectedMeta} numberOfLines={1}>
                {matchSelectedItem?.source || 'web'}
              </Text>
            </View>
          </View>

          <View style={{ gap: 8, marginTop: 3 }}>
            <TouchableOpacity
              style={[styles.mainButton, styles.matchPrimaryButton, matchSubmitting && styles.disabledButton]}
              disabled={matchSubmitting}
              onPress={onMatchConfirm}
            >
              <Icon name="arrow-right" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.mainButtonText}>Confirm Selection</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.matchSecondaryButton, matchSubmitting && styles.disabledButton]}
              disabled={matchSubmitting}
              onPress={onMatchDeny}
            >
              <Icon name="link-off" size={18} color="#888" style={{ marginRight: 8 }} />
              <Text style={styles.secondaryButtonText}>Product not in results</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {state === 'match_assist_input' && (
        <View style={styles.matchFooterWrap}>
          <View style={styles.matchAssistHeaderRow}>
            {onMatchReselect ? (
              <TouchableOpacity
                onPress={onMatchReselect}
                style={styles.matchReselectBtn}
                disabled={matchSubmitting}
              >
                <Icon name="redo-variant" size={16} color="#6B7280" />
                <Text style={styles.matchReselectText}>Reselect matches</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={styles.matchHeader}>Could you provide more details?</Text>
          </View>
          <Text style={styles.matchPromptText}>
            {'Add barcode, model, or title text, or continue with best guess.'}
          </Text>

          <SmartCommandInput
            mode="quick_fix"
            variant="inline"
            startExpanded={true}
            disableKeyboardHandling={true}
            placeholder={matchInputLabel}
            value={matchInputValue}
            onTextChange={onMatchInputChange}
            submitLabel="Search again"
            designVariant="v2"
            isLoading={matchSubmitting}
            onSubmit={(text) => {
              if (onMatchSubmitDetails) onMatchSubmitDetails(text);
            }}
          />

          <TouchableOpacity
            style={[styles.matchSecondaryButton, styles.matchBestGuessBtn, matchSubmitting && styles.disabledButton]}
            disabled={matchSubmitting}
            onPress={onMatchBestGuess}
          >
            <Text style={styles.matchBestGuessText}>Just give your best guess</Text>
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
    justifyContent: 'flex-start',
    marginTop: 10,
    backgroundColor: 'rgb(255, 255, 255)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
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
    maxHeight: 250,
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
    paddingVertical: 18,
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
    paddingVertical: 18,
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
    paddingVertical: 18,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%'
  },
  backButtonText: { color: '#888', fontSize: 16, fontWeight: '600' },
  optionalTemplateLink: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  optionalTemplateLinkText: {
    color: '#666',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
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
  platformForAllLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4
  },
  platformGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 8
  },
  platformSubheaderText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000'
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
  manualSafetyWrap: {
    width: '100%',
    marginBottom: 20,
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  manualSafetyLabel: {
    color: '#4b5563',
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '500',
  },
  manualSafetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  manualSafetyInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
    backgroundColor: '#FFF',
    fontSize: 14,
  },
  manualSafetyButton: {
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualSafetyButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
  matchFooterWrap: {
    marginBottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 12,
  },
  matchAssistHeaderRow: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
  },
  matchReselectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  matchReselectText: {
    color: '#4B5563',
    fontSize: 11,
    fontWeight: '600',
  },
  matchHeader: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '600',
  },
  matchPromptText: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: -2,
  },
  matchSelectedCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F8FAFC',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  matchSelectedThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  matchSelectedThumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  matchSelectedTitle: {
    color: '#111827',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  matchSelectedMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 3,
  },
  matchBestGuessBtn: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 0,
    borderColor: '#E5E7EB',
    minHeight: 24,
  },
  matchBestGuessText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '600',
  },
  matchPrimaryButton: {
    minHeight: 54,
    height: 54,
    marginTop: 0,
    borderRadius: 12,
  },
  matchSecondaryButton: {
    minHeight: 54,
    height: 54,
    marginTop: 0,
    borderRadius: 12,
  },
});
