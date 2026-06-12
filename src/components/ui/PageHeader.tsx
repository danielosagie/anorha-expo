// PageHeader — the settings-subpage header for the new design language
// (extracted from ConnectionsScreen): a floating white back circle, then the big
// Inter bold title. Place inside a ScrollView whose contentContainer already
// applies paddingTop: insets.top + 8 and paddingHorizontal: 18.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';

export interface PageHeaderProps {
  title: string;
  onBack: () => void;
  /** Optional element rendered on the right side of the back row (e.g. an action pill). */
  right?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, onBack, right }) => (
  <>
    <View style={styles.headerRow}>
      <TouchableOpacity style={styles.backCircle} onPress={onBack} activeOpacity={0.85}>
        <ChevronLeft size={22} color="#18181B" />
      </TouchableOpacity>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
    <Text style={styles.title}>{title}</Text>
  </>
);

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 32, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 18 },
});

export default PageHeader;
