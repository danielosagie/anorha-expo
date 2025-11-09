import React from 'react';
import { View, Text, Button, StyleSheet, ScrollView } from 'react-native';

interface ErrorAlertProps {
  errors: string[];
  onRetry?: () => void;
  title?: string;
}

const ErrorAlert: React.FC<ErrorAlertProps> = ({ errors, onRetry, title = 'Errors Occurred' }) => {
  if (errors.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <ScrollView style={styles.errorsContainer}>
        {errors.map((error, index) => (
          <Text key={index} style={styles.error}>{error}</Text>
        ))}
      </ScrollView>
      {onRetry && <Button title="Retry" onPress={onRetry} color="#2196F3" />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffebee',
    borderRadius: 8,
    padding: 16,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#f44336',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#d32f2f',
    marginBottom: 10,
  },
  errorsContainer: {
    maxHeight: 150,
  },
  error: {
    fontSize: 14,
    color: '#c62828',
    marginBottom: 5,
  },
});

export default ErrorAlert;
