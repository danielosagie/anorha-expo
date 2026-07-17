// The calm AI disclaimer that sits directly under the latest response controls.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AnorhaFace } from '../../../components/brand/AnorhaFace';

export const SproutDisclaimer = () => (
  <View style={styles.wrap}>
    <View style={styles.mark}>
      <AnorhaFace size={20} />
    </View>
    <View style={styles.textMark}>
      <Text style={styles.text}>Sprout can make mistakes. Check important details.</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 7,
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 0,
    marginBottom: 0,
  },
  mark: {
    width: "60%",
    flexWrap: "wrap",
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textMark: {
    width: "50%",
    flexWrap: "wrap",
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'left',
  },
});

export default SproutDisclaimer;
