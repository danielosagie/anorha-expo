import React from 'react';
import { View, Text, ActivityIndicator, Button, StyleSheet, Modal } from 'react-native';

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  onCancel?: () => void;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ visible, message = 'Loading...', onCancel }) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.message}>{message}</Text>
          {onCancel && <Button title="Cancel" onPress={onCancel} color="#ff4444" />}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  message: {
    marginVertical: 10,
    fontSize: 16,
  },
});

export default LoadingOverlay;
