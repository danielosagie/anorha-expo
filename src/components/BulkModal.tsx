import React from 'react';
import { StyleSheet, Modal,View, Touchable } from 'react-native';


function BulkModal() {
    return (
        {/* --- Bulk Jobs Modal --- */}
      <Modal
      animationType="fade"
      transparent={true}
      visible={bulkModalVisible}
      onRequestClose={() => setBulkModalVisible(false)}
    >
      <View style={styles.modalContainer}>
        <View style={[styles.modalContent, { maxHeight: '70%', height: '70%' }]}> 
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setBulkModalVisible(false)}>
              <Icon name="close" size={22} color="#000" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Current Jobs</Text>
            <View style={{ width: 24 }} />
      </View>

          
          <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8 }}>
            {(['items'] as const).map((t) => ( //{,'match','generate'}
              <TouchableOpacity key={t} onPress={() => setBulkTab(t)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: bulkTab===t?'#93C822':'#E5E5E5', borderRadius: 8, marginRight: 8 }}>
                <Text style={{ color: '#000' }}>{t === 'items' ? 'Items' : (t === 'match' ? 'Match Jobs' : 'Generate Jobs')}</Text>
              </TouchableOpacity>
            ))}
          </View>
  
          <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
            {bulkTab === 'items' && (
              <View style={{ paddingVertical: 8 }}>
                {(!analysisData || !analysisData.results || analysisData.results.length === 0) && (
                  <Text style={{ color: '#000' }}>No items available.</Text>
                )}
                {(analysisData?.results || []).map((res, idx) => {
                  const first = res?.serpApiData?.[0];
                  const thumb = first?.image || first?.thumbnail || '';
                  const title = first?.title || `Item ${idx + 1}`;
                  // Stage statuses
                  const scanStatus: 'gray'| 'green' | 'yellow' | 'red' = analysisData ? 'green' : (isLoading ? 'yellow' : 'red');
                  const matchStatus: 'green' | 'yellow' | 'red' = (idx === currentProductIndex && selectedIndices.length > 0) ? 'green' : 'yellow';
                  const genInfo = itemGenerateJobs[idx];
                  const detailsStatus: 'green' | 'yellow' | 'red' = genInfo ? (genInfo.status === 'completed' ? 'green' : (genInfo.status === 'failed' ? 'red' : 'yellow')) : 'yellow';
                  return (
                    <TouchableOpacity key={`item-${idx}`} onPress={() => {
                      setCurrentProductIndex(idx);
                      setSelectedIndices([]);
                      setSelectedPlatforms([]);
                      setSelectedTemplate(null);
                      setBulkModalVisible(false);
                      setBottomNavState('empty');
                    }} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: idx===currentProductIndex? 'rgba(147,200,34,0.08)':'#fff' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {!!thumb && <Image source={{ uri: thumb }} style={{ width: 36, height: 36, borderRadius: 6, marginRight: 10 }} />}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#000', fontWeight: '600' }}>{title}</Text>
                          <Text style={{ color: '#000' }}>Matches: {res?.serpApiData?.length || 0}</Text>
                          {/* Stage pills */}
                          <View style={{ flexDirection: 'row', marginTop: 6 }}>
                            {/* Scan */}
                            <TouchableOpacity onPress={() => {
                              // For now, just focus this item; scanning is already complete once analysis loaded
                              setCurrentProductIndex(idx);
                              setBulkModalVisible(false);
                            }} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 8, marginRight: 6, flexDirection: 'row', alignItems: 'center' }}>
                              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: scanStatus }} />
                              <Text style={{ color: '#000', marginLeft: 6 }}>Scan</Text>
                            </TouchableOpacity>
                            {/* Match */}
                            <TouchableOpacity onPress={() => {
                              setCurrentProductIndex(idx);
                              setBulkModalVisible(false);
                              setBottomNavState('selection');
                            }} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 8, marginRight: 6, flexDirection: 'row', alignItems: 'center' }}>
                              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: matchStatus }} />
                              <Text style={{ color: '#000', marginLeft: 6 }}>Match</Text>
                            </TouchableOpacity>
                            {/* Details */}
                            <TouchableOpacity onPress={() => {
                              const jobId = itemGenerateJobs[idx]?.jobId;
                              if (jobId) {
                                navigation.navigate('LoadingScreen' as never, {
                                  processType: 'generate',
                                  payload: { jobId, firstPhotos: [] },
                                  onCompleteRoute: { screen: 'GenerateDetailsScreen', params: { jobId } }
                                } as never);
                                setBulkModalVisible(false);
                              }
                            }} disabled={!itemGenerateJobs[idx]?.jobId} style={{ opacity: itemGenerateJobs[idx]?.jobId ? 1 : 0.5, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
                              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: detailsStatus }} />
                              <Text style={{ color: '#000', marginLeft: 6 }}>Details</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        {idx === currentProductIndex && <Icon name="check-circle" size={18} color="#93C822" />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/*bulkTab === 'match' && (
              <View style={{ paddingVertical: 8 }}>
                {loadingBulk ? <ActivityIndicator color="#93C822" /> : null}
                {(matchJobs || []).map((job) => (
                  <TouchableOpacity key={job.jobId} onPress={() => {
                    setBulkModalVisible(false);
                    navigation.navigate('LoadingScreen' as never, {
                      processType: 'match',
                      payload: { jobId: job.jobId, firstPhotos: [] },
                      onCompleteRoute: {
                        screen: 'MatchSelectionScreen',
                        params: {
                          jobResponse: { jobId: job.jobId, status: job.status, estimatedTimeMinutes: 0, totalProducts: job.totalProducts || 0, message: '' },
                          response: { jobId: job.jobId },
                        }
                      }
                    } as never);
                  }} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <Text style={{ color: '#000', fontWeight: '600' }}>{job.jobId}</Text>
                    <Text style={{ color: '#000' }}>Status: {job.status}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )*/}

            {/*bulkTab === 'generate' && (
              <View style={{ paddingVertical: 8 }}>
                {loadingBulk ? <ActivityIndicator color="#93C822" /> : null}
                {(generateJobs || []).map((job) => (
                  <TouchableOpacity key={job.jobId} onPress={() => {
                    setBulkModalVisible(false);
                    navigation.navigate('LoadingScreen' as never, {
                      processType: 'generate',
                      payload: { jobId: job.jobId, firstPhotos: [] },
                      onCompleteRoute: {
                        screen: 'GenerateDetailsScreen',
                        params: { jobId: job.jobId }
                      }
                    } as never);
                  }} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <Text style={{ color: '#000', fontWeight: '600' }}>{job.jobId}</Text>
                    <Text style={{ color: '#000' }}>Status: {job.status}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )*/}

          </ScrollView>
        </View>
      </View>
    </Modal>

    );
}

export default BulkModal;

