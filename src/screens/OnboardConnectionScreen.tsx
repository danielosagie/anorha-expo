import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const OnboardConnectionScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Onboard Connection</Text>
      <Text style={styles.subtitle}>Coming soon. </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
    padding: 16,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
});

export default OnboardConnectionScreen;






