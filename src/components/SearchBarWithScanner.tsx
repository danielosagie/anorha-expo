import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

interface SearchBarWithScannerProps {
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  onScan: (barcode: string) => void;
  onScannerOpen: () => void;
  onClear?: () => void;
  /** Voice button to the left of the barcode/scanner button */
  onVoicePress?: () => void;
}

const SearchBarWithScanner: React.FC<SearchBarWithScannerProps> = ({
  placeholder = 'Search for a product',
  value,
  onChangeText,
  onScan,
  onScannerOpen,
  onClear,
  onVoicePress,
}) => {
  const theme = useTheme();

  return (
    <View style={[styles.searchBar, { backgroundColor: "#FFF",}]}>
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
        style={styles.scannerButton}
        onPress={onScannerOpen}
        activeOpacity={0.7}
      >
        <Icon name="qrcode-scan" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    borderColor: "rgba(102,102,102,0.26)",
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
  },
  voiceButton: {
    padding: 8,
    marginLeft: 4,
  },
  scannerButton: {
    borderRadius: 8,
    backgroundColor: "#93C822",
    padding: 8,
    marginLeft: 8,
  },
});

export default SearchBarWithScanner;
