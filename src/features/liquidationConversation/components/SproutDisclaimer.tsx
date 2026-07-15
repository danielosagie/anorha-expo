// The calm AI disclaimer that sits directly under the latest response controls.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AnorhaFace } from '../../../components/brand/AnorhaFace';

export const SproutDisclaimer = () => (
  <View style={styles.wrap}>
    <View style={styles.mark}>
      <AnorhaFace size={13} />
    </View>
    <Text style={styles.text}>Sprout can make mistakes. Double-check important details.</Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 7,
    paddingTop: 0,
    paddingBottom: 6,
    paddingHorizontal: 0,
  },
  mark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(147,200,34,0.14)',
  },
  text: {
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    textAlign: 'left',
  },
});

export default SproutDisclaimer;
