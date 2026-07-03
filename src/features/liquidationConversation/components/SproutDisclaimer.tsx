// The calm AI disclaimer that sits at the end of the conversation, under the last
// message and above the composer — the anorha equivalent of Claude's "AI can make
// mistakes" footer. Brand leaf mark + one short line, faint so it never competes.
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
    justifyContent: 'center',
    gap: 7,
    paddingTop: 16,
    paddingBottom: 4,
    paddingHorizontal: 16,
  },
  mark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(147,200,34,0.14)',
  },
  text: {
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    fontSize: 11.5,
    textAlign: 'center',
  },
});

export default SproutDisclaimer;
