import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useActiveProcesses } from '../hooks/useProcessState';
import { ProcessPersistence, ProcessState, ProcessType, ProcessStatus } from '../utils/ProcessPersistence';

interface ProcessResumptionModalProps {
  visible: boolean;
  onClose: () => void;
  onResumeProcess: (process: ProcessState) => void;
}

const ProcessResumptionModal: React.FC<ProcessResumptionModalProps> = ({
  visible,
  onClose,
  onResumeProcess,
}) => {
  const { processes, refreshProcesses } = useActiveProcesses();
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [deletingProcessId, setDeletingProcessId] = useState<string | null>(null);
  const processPersistence = ProcessPersistence.getInstance();

  useEffect(() => {
    if (visible) {
      refreshProcesses();
    }
  }, [visible, refreshProcesses]);

  const getProcessIcon = (type: ProcessType): keyof typeof MaterialIcons.glyphMap => {
    switch (type) {
      case ProcessType.AI_GENERATION:
        return 'auto-awesome';
      case ProcessType.LISTING_CREATION:
        return 'add-shopping-cart';
      case ProcessType.PHOTO_UPLOAD:
        return 'photo-camera';
      case ProcessType.PRODUCT_MATCHING:
        return 'search';
      default:
        return 'settings';
    }
  };

  const getProcessTitle = (process: ProcessState): string => {
    switch (process.type as ProcessType) {
      case ProcessType.AI_GENERATION:
        return 'AI Product Generation';
      case ProcessType.LISTING_CREATION:
        return 'Create Listing';
      case ProcessType.PHOTO_UPLOAD:
        return 'Photo Upload';
      case ProcessType.PRODUCT_MATCHING:
        return 'Product Matching';
      default:
        return 'Process';
    }
  };

  const getProcessDescription = (process: ProcessState): string => {
    const minutesAgo = Math.floor((Date.now() - process.updatedAt) / (1000 * 60));
    const timeText = minutesAgo < 1 ? 'Just now' : `${minutesAgo}m ago`;
    
    return `${process.currentStage} • ${Math.round(process.progress)}% complete • ${timeText}`;
  };

  const getStatusColor = (status: ProcessStatus): string => {
    switch (status) {
      case ProcessStatus.IN_PROGRESS:
        return '#007AFF';
      case ProcessStatus.PAUSED:
        return '#FF9500';
      case ProcessStatus.FAILED:
        return '#FF3B30';
      default:
        return '#8E8E93';
    }
  };

  const handleResumeProcess = (process: ProcessState) => {
    setSelectedProcess(process.id);
    
    // Give visual feedback, then resume
    setTimeout(() => {
      onResumeProcess(process);
      setSelectedProcess(null);
      onClose();
    }, 500);
  };

  const handleDeleteProcess = (process: ProcessState) => {
    Alert.alert(
      'Delete Process',
      'Are you sure you want to delete this process? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingProcessId(process.id);
            try {
              await processPersistence.deleteProcess(process.id);
              refreshProcesses();
            } finally {
              setDeletingProcessId(null);
            }
          },
        },
      ]
    );
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Resume Process</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <MaterialIcons name="close" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        {processes.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="done-all" size={64} color="#8E8E93" />
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyDescription}>
              No ongoing processes to resume.
            </Text>
          </View>
        ) : (
          <ScrollView style={styles.processList} showsVerticalScrollIndicator={false}>
            {processes.map((process) => (
              <View key={process.id} style={styles.processCard}>
                <View style={styles.processHeader}>
                  <View style={styles.processIconContainer}>
                    <MaterialIcons
                      name={getProcessIcon(process.type)}
                      size={24}
                      color="#007AFF"
                    />
                  </View>
                  <View style={styles.processInfo}>
                    <Text style={styles.processTitle}>
                      {getProcessTitle(process)}
                    </Text>
                    <Text style={styles.processDescription}>
                      {getProcessDescription(process)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: getStatusColor(process.status) },
                    ]}
                  >
                    <Text style={styles.statusText}>
                      {process.status.toLowerCase()}
                    </Text>
                  </View>
                </View>

                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${process.progress}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>{Math.round(process.progress)}%</Text>
                </View>

                <View style={styles.processActions}>
                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      styles.resumeButton,
                      selectedProcess === process.id && styles.resumeButtonLoading,
                    ]}
                    onPress={() => handleResumeProcess(process)}
                    disabled={selectedProcess === process.id}
                  >
                    {selectedProcess === process.id ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <MaterialIcons name="play-arrow" size={20} color="#FFF" />
                    )}
                    <Text style={styles.resumeButtonText}>
                      {selectedProcess === process.id ? 'Opening...' : 'Resume'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={() => handleDeleteProcess(process)}
                    disabled={deletingProcessId === process.id}
                  >
                    {deletingProcessId === process.id ? (
                      <ActivityIndicator size="small" color="#FF3B30" />
                    ) : (
                      <MaterialIcons name="delete-outline" size={20} color="#FF3B30" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  closeButton: {
    padding: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#000',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 22,
  },
  processList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  processCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  processHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  processIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  processInfo: {
    flex: 1,
  },
  processTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  processDescription: {
    fontSize: 14,
    color: '#8E8E93',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFF',
    textTransform: 'capitalize',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#E5E5EA',
    borderRadius: 2,
    marginRight: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8E8E93',
    minWidth: 32,
    textAlign: 'right',
  },
  processActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  resumeButton: {
    backgroundColor: '#007AFF',
    flex: 1,
    marginRight: 8,
    justifyContent: 'center',
  },
  resumeButtonLoading: {
    backgroundColor: '#5AC8FA',
  },
  resumeButtonText: {
    color: '#FFF',
    fontWeight: '600',
    marginLeft: 4,
  },
  deleteButton: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
});

export default ProcessResumptionModal;
