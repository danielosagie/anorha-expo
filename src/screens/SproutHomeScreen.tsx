import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const SproutHomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.shell}>
        <View style={styles.badge}>
          <Icon name="sprout-outline" size={16} color="#6B7280" />
          <Text style={styles.badgeText}>Sprout</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Icon name="hammer-screwdriver" size={26} color="#111827" />
          </View>
          <Text style={styles.title}>Under construction</Text>
          <Text style={styles.description}>
            We are rebuilding Sprout right now. Dashboard, inventory, imports, and product workflows still work as normal.
          </Text>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Dashboard')}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Back to dashboard</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.noteRow}>
          <Text style={styles.noteLabel}>Temporary status</Text>
          <Text style={styles.noteText}>This tab is parked while the new Sprout experience is being finished.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F1EA',
  },
  shell: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  badge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.06)',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 28,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: '#F3EFE8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    lineHeight: 31,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#6B7280',
    marginBottom: 22,
  },
  primaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  noteRow: {
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.06)',
  },
  noteLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
  },
});

export default SproutHomeScreen;
