import React from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Image as RNImage } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Sparkles, Link, Unlink, Hammer } from 'lucide-react-native';

import { useTheme } from '../../context/ThemeContext';
import Button from '../Button';
import PlatformLogo from '../PlatformLogo';
import { getPlatformColor } from '../../config/platforms';
import type { UseImportSessionResult } from '../../hooks/useImportSession';
import type { ImportSessionCounts } from '../../types/importSession';

const AnorhaLogo = require('../../assets/rounded_anorha.png');

const WIZARD_STEP_CONFIG: Record<number, { title: string; description?: string }> = {
  0: { title: 'Choose Import Direction', description: 'Pick how products should flow between this platform and Anorha.' },
  1: { title: 'Assign Pool & Locations', description: 'Map this connection and locations to the right pool.' },
  2: { title: 'Advanced Settings', description: 'Optional sync behavior controls.' },
  3: { title: 'Advanced Settings', description: 'Optional delist behavior controls.' },
  4: { title: 'Advanced Settings', description: 'Optional price adjustment controls.' },
  5: { title: 'Advanced Settings', description: 'Optional inventory buffer controls.' },
  6: { title: 'Review & Complete', description: 'Confirm mappings and start the import sync.' },
};


export interface ImportWizardSheetProps {
  visible: boolean;
  onClose: () => void;
  platformName: string;
  connection: any;
  counts: ImportSessionCounts;
  session: UseImportSessionResult;
  showReselectMatches?: boolean;
}

export function ImportWizardSheet({
  visible,
  onClose,
  platformName,
  connection,
  counts,
  session,
  showReselectMatches = false,
}: ImportWizardSheetProps) {
  const theme = useTheme();
  const {
    wizardStep,
    setWizardStep,
    setWizardVisible,
    productCreationMode,
    setProductCreationMode,
    selectedPool,
    setSelectedPool,
    poolNameInput,
    setPoolNameInput,
    pools,
    displayConnectionLocations,
    locationPoolAssignments,
    setLocationPoolAssignments,
    isLoadingPools,
    isLoadingLocations,
    isCreatingPool,
    syncMode,
    setSyncMode,
    delistMode,
    setDelistMode,
    priceBuffer,
    setPriceBuffer,
    inventoryBuffer,
    setInventoryBuffer,
    platformConnections,
    handleCreatePool,
    submitImport,
    isSubmitting,
  } = session;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.7)' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0)' }} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1 }} scrollEnabled nestedScrollEnabled>
            <View
              style={{
                backgroundColor: '#fff',
                borderRadius: 16,
                padding: 20,
                ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4 }, android: { elevation: 3 } }),
                paddingBottom: 32,
              }}
            >
              <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                {wizardStep === 0 && showReselectMatches && (
                  <TouchableOpacity style={{ alignSelf: 'center', marginBottom: 12 }} onPress={() => setWizardVisible(false)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="arrow-u-left-top" size={16} color="#6B7280" />
                      <Text style={{ color: '#6B7280', fontSize: 14 }}>Reselect Matches</Text>
                    </View>
                  </TouchableOpacity>
                )}

                <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text, textAlign: 'center' }}>
                  {WIZARD_STEP_CONFIG[wizardStep]?.title || 'Setup'}
                </Text>
                {WIZARD_STEP_CONFIG[wizardStep]?.description && (
                  <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', fontSize: 14, marginTop: 8 }}>
                    {WIZARD_STEP_CONFIG[wizardStep]?.description}
                  </Text>
                )}
              </View>

              <View style={{ height: 1, backgroundColor: '#E5E5E5', marginBottom: 16 }} />

              {/* Step 0 */}
              {wizardStep === 0 && (
                <View style={{ paddingHorizontal: 0, minHeight: 300 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 24 }}>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        borderWidth: 2,
                        borderColor: productCreationMode === 'pull_only' ? theme.colors.primary : '#E5E7EB',
                        borderRadius: 12,
                        paddingVertical: 16,
                        paddingHorizontal: 4,
                        backgroundColor: productCreationMode === 'pull_only' ? theme.colors.primary + '15' : '#fff',
                        alignItems: 'center',
                      }}
                      onPress={() => setProductCreationMode('pull_only')}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10, height: 52, gap: 2 }}>
                        <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 3, borderWidth: 1.5, borderColor: '#E5E7EB' }}>
                          <PlatformLogo type={platformName ?? ''} size={32} fallbackIcon="store" />
                        </View>
                        <Icon name="arrow-right" size={20} color={theme.colors.primary} />
                        <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 3, borderWidth: 2, borderColor: theme.colors.primary }}>
                          <RNImage source={AnorhaLogo} style={{ width: 32, height: 32, borderRadius: 6 }} />
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text, textAlign: 'center' }}>Import to Anorha</Text>
                      <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                        Pull items from {platformName || 'platform'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={{
                        flex: 1,
                        borderWidth: 2,
                        borderColor: productCreationMode === 'sync_everywhere' ? theme.colors.primary : '#E5E7EB',
                        borderRadius: 12,
                        paddingVertical: 16,
                        paddingHorizontal: 8,
                        backgroundColor: productCreationMode === 'sync_everywhere' ? theme.colors.primary + '15' : '#fff',
                        alignItems: 'center',
                      }}
                      onPress={() => setProductCreationMode('sync_everywhere')}
                    >
                      <View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 10, height: 52, width: '100%' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                          <View
                            style={{
                              backgroundColor: '#fff',
                              borderRadius: 8,
                              padding: 3,
                              borderWidth: 2,
                              borderColor: theme.colors.primary,
                              zIndex: 5,
                              ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }, android: { elevation: 2 } }),
                            }}
                          >
                            <RNImage source={AnorhaLogo} style={{ width: 32, height: 32, borderRadius: 6 }} />
                          </View>
                          {platformConnections.slice(0, 2).map((conn: any, index: number) => {
                            const pt = conn.PlatformType?.toLowerCase() || '';
                            return (
                              <View
                                key={conn.Id}
                                style={{
                                  marginLeft: -12,
                                  backgroundColor: '#fff',
                                  borderRadius: 8,
                                  padding: 3,
                                  borderWidth: 1.5,
                                  borderColor: '#E5E7EB',
                                  zIndex: 3 - index,
                                  ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }, android: { elevation: 2 } }),
                                }}
                              >
                                <PlatformLogo type={pt} size={32} fallbackIcon="store" />
                              </View>
                            );
                          })}
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text, textAlign: 'center' }}>Sync Everywhere</Text>
                      <Text style={{ fontSize: 10, color: '#4A6C1C', marginTop: 2, fontWeight: '700' }}>Recommended</Text>
                      <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 4 }}>Adds missing items to ALL platforms</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={{
                        flex: 1,
                        borderWidth: 2,
                        borderColor: productCreationMode === 'push_only' ? theme.colors.primary : '#E5E7EB',
                        borderRadius: 12,
                        paddingVertical: 16,
                        paddingHorizontal: 4,
                        backgroundColor: productCreationMode === 'push_only' ? theme.colors.primary + '15' : '#fff',
                        alignItems: 'center',
                      }}
                      onPress={() => setProductCreationMode('push_only')}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10, height: 52, gap: 6 }}>
                        <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 3, borderWidth: 1.5, borderColor: '#E5E7EB' }}>
                          <RNImage source={AnorhaLogo} style={{ width: 32, height: 32, borderRadius: 6 }} />
                        </View>
                        <Icon name="arrow-right" size={20} color={theme.colors.primary} />
                        <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 3, borderWidth: 2, borderColor: theme.colors.primary }}>
                          <PlatformLogo type={platformName ?? ''} size={32} fallbackIcon="store" />
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text, textAlign: 'center' }}>Push to {platformName || 'Platform'}</Text>
                      <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 4 }}>Send Anorha items here</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={{ backgroundColor: '#5C9B00', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}
                    onPress={() => setWizardStep(1)}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Continue</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ backgroundColor: '#E5E5E5', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
                    onPress={() => {
                      setProductCreationMode('do_nothing');
                      setWizardStep(1);
                    }}
                  >
                    <Text style={{ color: '#71717A', fontWeight: '600', fontSize: 16 }}>Skip - Don't create missing items</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Step 1 - Pool Assignment */}
              {wizardStep === 1 && (
                <View style={{ paddingHorizontal: 0, paddingTop: 0 }}>
                  {(isLoadingPools || isLoadingLocations) ? (
                    <View style={{ padding: 40, alignItems: 'center' }}>
                      <ActivityIndicator size="large" color={theme.colors.primary} />
                      <Text style={{ marginTop: 12, color: theme.colors.textSecondary }}>Loading locations and pools...</Text>
                    </View>
                  ) : displayConnectionLocations.length === 0 ? (
                    <View style={{ width: '100%', marginTop: 20 }}>
                      {pools.length > 0 &&
                        pools.map((pool) => (
                          <TouchableOpacity
                            key={pool.id}
                            style={{
                              borderWidth: 1,
                              borderColor: selectedPool === pool.id ? theme.colors.primary : '#E5E7EB',
                              borderRadius: 12,
                              padding: 16,
                              marginBottom: 8,
                              backgroundColor: selectedPool === pool.id ? theme.colors.primary + '10' : '#fff',
                              flexDirection: 'row',
                              alignItems: 'center',
                            }}
                            onPress={() => setSelectedPool(pool.id)}
                          >
                            <Text style={{ flex: 1, fontWeight: '600', color: theme.colors.text }}>{pool.name}</Text>
                            <View
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 10,
                                borderWidth: 2,
                                borderColor: selectedPool === pool.id ? theme.colors.primary : '#E5E7EB',
                                backgroundColor: selectedPool === pool.id ? theme.colors.primary : 'transparent',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {selectedPool === pool.id && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />}
                            </View>
                          </TouchableOpacity>
                        ))}
                    </View>
                  ) : (
                    <>
                      <View style={{ marginBottom: 20 }}>
                        <Text style={{ fontWeight: '700', fontSize: 14, color: theme.colors.text, marginBottom: 12, textTransform: 'uppercase' }}>
                          {connection?.DisplayName || platformName} Locations ({displayConnectionLocations.length})
                        </Text>
                        {displayConnectionLocations.map((location) => {
                          const assignedPoolId = locationPoolAssignments[location.platformLocationId] || selectedPool;
                          return (
                            <View
                              key={location.platformLocationId}
                              style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, marginBottom: 10, backgroundColor: '#fff' }}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                                <Icon name="map-marker" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontWeight: '600', fontSize: 15, color: theme.colors.text }}>{location.locationName}</Text>
                                  {location.timezone && <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{location.timezone}</Text>}
                                </View>
                              </View>
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                {pools.map((pool) => (
                                  <TouchableOpacity
                                    key={pool.id}
                                    style={{
                                      paddingHorizontal: 12,
                                      paddingVertical: 8,
                                      borderRadius: 20,
                                      borderWidth: 1,
                                      borderColor: assignedPoolId === pool.id ? theme.colors.primary : '#D1D5DB',
                                      backgroundColor: assignedPoolId === pool.id ? theme.colors.primary + '15' : '#F9FAFB',
                                    }}
                                    onPress={() => setLocationPoolAssignments((prev) => ({ ...prev, [location.platformLocationId]: pool.id }))}
                                  >
                                    <Text style={{ fontSize: 13, fontWeight: '600', color: assignedPoolId === pool.id ? theme.colors.primary : theme.colors.textSecondary }}>{pool.name}</Text>
                                  </TouchableOpacity>
                                ))}
                                <TouchableOpacity
                                  style={{
                                    paddingHorizontal: 12,
                                    paddingVertical: 8,
                                    borderRadius: 20,
                                    borderWidth: 1,
                                    borderStyle: 'dashed',
                                    borderColor: assignedPoolId === 'create-new' ? theme.colors.primary : '#D1D5DB',
                                    backgroundColor: assignedPoolId === 'create-new' ? theme.colors.primary + '15' : 'transparent',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                  onPress={() => {
                                    setLocationPoolAssignments((prev) => ({ ...prev, [location.platformLocationId]: 'create-new' }));
                                    setSelectedPool('create-new');
                                  }}
                                >
                                  <Icon name="plus" size={14} color={assignedPoolId === 'create-new' ? theme.colors.primary : theme.colors.textSecondary} />
                                  <Text style={{ fontSize: 13, fontWeight: '600', color: assignedPoolId === 'create-new' ? theme.colors.primary : theme.colors.textSecondary }}>New Pool</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                      {(selectedPool === 'create-new' || Object.values(locationPoolAssignments).includes('create-new')) && (
                        <View
                          style={{
                            marginBottom: 16,
                            padding: 16,
                            backgroundColor: theme.colors.primary + '10',
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: theme.colors.primary + '30',
                          }}
                        >
                          <Text style={{ fontWeight: '600', color: theme.colors.text, marginBottom: 8 }}>New Pool Name</Text>
                          <TextInput
                            style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, color: theme.colors.text, fontSize: 16, backgroundColor: '#fff' }}
                            placeholder="e.g., Main Retail"
                            placeholderTextColor={theme.colors.textSecondary}
                            value={poolNameInput}
                            onChangeText={setPoolNameInput}
                            editable={!isCreatingPool}
                          />
                          <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 8 }}>
                            {Object.values(locationPoolAssignments).filter((p) => p === 'create-new').length} location(s) will be added to this new pool
                          </Text>
                        </View>
                      )}
                      {displayConnectionLocations.length > 1 && pools.length > 0 && (
                        <View style={{ marginBottom: 16 }}>
                          <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 8 }}>Quick assign all locations:</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              {pools.map((pool) => (
                                <TouchableOpacity
                                  key={`quick-${pool.id}`}
                                  style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' }}
                                  onPress={() => {
                                    const next: Record<string, string> = {};
                                    displayConnectionLocations.forEach((loc) => (next[loc.platformLocationId] = pool.id));
                                    setLocationPoolAssignments(next);
                                    setSelectedPool(pool.id);
                                  }}
                                >
                                  <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text }}>All → {pool.name}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </ScrollView>
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}

              {/* Steps 2-5: Advanced settings (abbreviated - same structure as MappingReviewScreen) */}
              {wizardStep === 2 && (
                <View style={{ paddingTop: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'column', gap: 6, alignItems: 'center', borderWidth: 1, borderColor: syncMode === 'auto' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }}
                      onPress={() => setSyncMode('auto')}
                    >
                      <Sparkles width={32} height={32} />
                      <Text style={{ fontWeight: '600', color: theme.colors.text }}>Auto</Text>
                      <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>(timestamp-based)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'column', gap: 6, alignItems: 'center', borderWidth: 1, borderColor: syncMode === 'manual' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }}
                      onPress={() => setSyncMode('manual')}
                    >
                      <Hammer width={32} height={32} />
                      <Text style={{ fontWeight: '600', color: theme.colors.text }}>Manual</Text>
                      <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>(Manual Approval)</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {wizardStep === 3 && (
                <View style={{ paddingTop: 20 }}>
                  <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'column', gap: 6, alignItems: 'center', borderWidth: 1, borderColor: delistMode === 'auto' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }}
                      onPress={() => setDelistMode('auto')}
                    >
                      <Unlink width={32} height={32} />
                      <Text style={{ fontWeight: '600', color: theme.colors.text }}>Auto Delist</Text>
                      <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginTop: 4 }}>Sold listings are automatically removed</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'column', gap: 6, alignItems: 'center', borderWidth: 1, borderColor: delistMode === 'manual' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }}
                      onPress={() => setDelistMode('manual')}
                    >
                      <Link width={32} height={32} />
                      <Text style={{ fontWeight: '600', color: theme.colors.text }}>Manual Delist</Text>
                      <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>Sold listings stay up</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {wizardStep === 4 && (
                <View style={{ paddingTop: 20 }}>
                  <View style={{ marginBottom: 24 }}>
                    {platformConnections.map((conn: any) => (
                      <View key={conn.Id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: getPlatformColor(conn.PlatformType), marginRight: 12 }} />
                          <View>
                            <Text style={{ fontWeight: '600', color: theme.colors.text }}>{conn.DisplayName}</Text>
                            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{conn.PlatformType}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <TouchableOpacity style={{ padding: 8 }} onPress={() => setPriceBuffer((p) => ({ ...p, [conn.Id]: (p[conn.Id] || 0) - 1 }))}>
                            <Icon name="minus" size={18} />
                          </TouchableOpacity>
                          <TextInput
                            style={{ width: 60, textAlign: 'center', fontWeight: '700', color: theme.colors.text, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, paddingVertical: 4 }}
                            value={`${(priceBuffer[conn.Id] || 0).toFixed(1)}%`}
                            onChangeText={(text) => {
                              const n = parseFloat(text.replace('%', '')) || 0;
                              setPriceBuffer((p) => ({ ...p, [conn.Id]: n }));
                            }}
                            keyboardType="numeric"
                          />
                          <TouchableOpacity style={{ padding: 8 }} onPress={() => setPriceBuffer((p) => ({ ...p, [conn.Id]: (p[conn.Id] || 0) + 1 }))}>
                            <Icon name="plus" size={18} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {wizardStep === 5 && (
                <View style={{ paddingTop: 20 }}>
                  <Text style={{ color: theme.colors.textSecondary, marginBottom: 20, textAlign: 'center' }}>Adjust inventory buffer per platform (Optional)</Text>
                  <View style={{ marginBottom: 24 }}>
                    {platformConnections.map((conn: any) => (
                      <View key={conn.Id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: getPlatformColor(conn.PlatformType), marginRight: 12 }} />
                          <View>
                            <Text style={{ fontWeight: '600', color: theme.colors.text }}>{conn.DisplayName}</Text>
                            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{conn.PlatformType}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <TouchableOpacity style={{ padding: 8 }} onPress={() => setInventoryBuffer((p) => ({ ...p, [conn.Id]: Math.max(0, (p[conn.Id] || 0) - 1) }))}>
                            <Icon name="minus" size={18} />
                          </TouchableOpacity>
                          <TextInput
                            style={{ width: 60, textAlign: 'center', fontWeight: '700', color: theme.colors.text, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, paddingVertical: 4 }}
                            value={`${inventoryBuffer[conn.Id] || 0}`}
                            onChangeText={(text) => {
                              const n = Math.max(0, parseInt(text, 10) || 0);
                              setInventoryBuffer((p) => ({ ...p, [conn.Id]: n }));
                            }}
                            keyboardType="numeric"
                          />
                          <TouchableOpacity style={{ padding: 8 }} onPress={() => setInventoryBuffer((p) => ({ ...p, [conn.Id]: (p[conn.Id] || 0) + 1 }))}>
                            <Icon name="plus" size={18} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Step 6 - Review & Complete */}
              {wizardStep === 6 && (
                <View style={{ paddingTop: 20 }}>
                  <View style={{ backgroundColor: '#F0F9EB', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#93C822' }}>
                    <Text style={{ fontWeight: '700', color: '#4A6C1C', marginBottom: 8 }}>What will happen:</Text>
                    <Text style={{ color: '#5B8325', fontSize: 14, lineHeight: 22 }}>
                      {productCreationMode === 'sync_everywhere'
                        ? `• Importing ${counts.matched + counts.review} items from ${platformName} → Anorha\n• Creating ${counts.review} new items on Anorha\n• Pushing ${counts.push} Anorha items → ${platformName}\n• All platforms will share the same unified inventory`
                        : productCreationMode === 'pull_only'
                        ? `• Importing ${counts.matched + counts.review} items from ${platformName} → Anorha\n• Creating ${counts.review} new items on Anorha\n• Linking ${counts.matched} existing matches`
                        : productCreationMode === 'push_only'
                        ? `• Pushing ${counts.push} Anorha items → ${platformName}\n• Linking ${counts.matched} matched items`
                        : `• Linking ${counts.matched} matched items\n• ${counts.review} items need review`}
                    </Text>
                  </View>
                  <View style={{ marginTop: 20 }}>
                    <Button title="Complete Import" loading={isSubmitting} onPress={submitImport} />
                  </View>
                </View>
              )}

              {/* Nav controls */}
              {wizardStep > 0 && wizardStep < 6 && (
                <>
                  <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 20, marginBottom: 8 }}>
                    {wizardStep === 1 && 'Pool Assignment'}
                    {[2, 3, 4, 5].includes(wizardStep) && 'Advanced Settings'}
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingHorizontal: 30 }}>
                    <TouchableOpacity
                      onPress={() => {
                        if (wizardStep === 1) setWizardStep(0);
                        else setWizardStep((s) => Math.max(1, s - 1));
                      }}
                      style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: '#9CA3AF', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Icon name="chevron-left" size={28} color="#fff" />
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {[0, 1, 6].map((i) => (
                        <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === wizardStep ? theme.colors.primary : '#E5E7EB' }} />
                      ))}
                    </View>
                    <TouchableOpacity
                      disabled={wizardStep === 1 && Object.values(locationPoolAssignments).includes('create-new') && !poolNameInput.trim()}
                      onPress={async () => {
                        if (wizardStep === 1 && Object.values(locationPoolAssignments).includes('create-new')) {
                          if (!poolNameInput.trim()) return;
                          await handleCreatePool();
                        } else if (wizardStep === 1) {
                          setWizardStep(6);
                        } else {
                          setWizardStep((s) => Math.min(6, s + 1));
                        }
                      }}
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: 12,
                        backgroundColor:
                          wizardStep === 1 && Object.values(locationPoolAssignments).includes('create-new') && !poolNameInput.trim() ? '#D1D5DB' : theme.colors.primary,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name="chevron-right" size={28} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
