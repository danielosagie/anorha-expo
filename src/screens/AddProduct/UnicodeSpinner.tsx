import React, { useState, useEffect } from 'react';
import { Text, StyleSheet, Platform } from 'react-native';
import { UnicodeSpinnerDefinition } from './types';

export const UnicodeSpinner: React.FC<{
  spinner: UnicodeSpinnerDefinition;
  color?: string;
  size?: number;
  style?: any;
}> = ({ spinner, color = '#4CAF50', size = 18, style }) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    const intervalId = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % spinner.frames.length);
    }, spinner.interval);
    return () => clearInterval(intervalId);
  }, [spinner]);

  return (
    <Text style={[styles.unicodeSpinnerText, { color, fontSize: size }, style]}>
      {spinner.frames[frameIndex]}
    </Text>
  );
};

const styles = StyleSheet.create({
  unicodeSpinnerText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    textAlign: 'center',
    includeFontPadding: false,
  },
});
