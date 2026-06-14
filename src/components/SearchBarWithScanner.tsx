import React, { useState } from 'react';
import {
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import ShadowSurface from './ui/ShadowSurface';

interface SearchBarWithScannerProps {
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  onScan: (barcode: string) => void;
  onScannerOpen: () => void;
  onClear?: () => void;
  /** Voice button to the left of the barcode/scanner button */
  onVoicePress?: () => void;
  scannerDisabled?: boolean;
  onScannerDisabledPress?: () => void;
  /** Drop the built-in bottom margin (e.g. when inline on a row with other buttons). */
  noBottomMargin?: boolean;
}

const SearchBarWithScanner: React.FC<SearchBarWithScannerProps> = ({
  placeholder = 'Search for a product',
  value,
  onChangeText,
  onScan,
  onScannerOpen,
  onClear,
  onVoicePress,
  scannerDisabled = false,
  onScannerDisabledPress,
  noBottomMargin = false,
}) => {
  const theme = useTheme();

  return (
    <ShadowSurface shadow="xs" style={[styles.searchBarWrapper, noBottomMargin && { marginBottom: 0 }]} innerStyle={[styles.searchBar, { backgroundColor: "#FFF" }]}>
      <Icon name="magnify" size={20} color="#999" style={styles.searchIcon} />
      <TextInput
        style={[styles.searchInput, { color: theme.colors.text }]}
        placeholder={placeholder}
        placeholderTextColor="#999"
        value={value}
        onChangeText={onChangeText}
      />
      {value ? (
        <TouchableOpacity onPress={() => { onChangeText(''); onClear?.(); }}>
          <Icon name="close" size={20} color="#999" />
        </TouchableOpacity>
      ) : null}
      {onVoicePress != null && (
        <TouchableOpacity
          style={styles.voiceButton}
          onPress={onVoicePress}
          activeOpacity={0.7}
        >
          <Icon name="microphone" size={20} color="#6B7280" />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[styles.scannerButton, scannerDisabled && styles.scannerButtonDisabled]}
        onPress={scannerDisabled ? (onScannerDisabledPress || onScannerOpen) : onScannerOpen}
        activeOpacity={0.7}
      >
        <Icon name="qrcode-scan" size={20} color={scannerDisabled ? '#6B7280' : '#fff'} />
      </TouchableOpacity>
    </ShadowSurface>
  );
};

const styles = StyleSheet.create({
  searchBarWrapper: {
    marginBottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 24,
    borderColor: "rgba(102,102,102,0.26)",
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  voiceButton: {
    padding: 8,
    marginLeft: 4,
  },
  scannerButton: {
    borderRadius: 8,
    backgroundColor: "#333333c6",
    padding: 8,
    marginLeft: 8,
  },
  scannerButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
});

export default SearchBarWithScanner;
