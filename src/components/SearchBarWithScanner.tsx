import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CameraView } from 'expo-camera';
import { useTheme } from '../context/ThemeContext';

interface SearchBarWithScannerProps {
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  onScan: (barcode: string) => void;
  onClear?: () => void;
}

const SearchBarWithScanner: React.FC<SearchBarWithScannerProps> = ({
  placeholder = 'Search for a product',
  value,
  onChangeText,
  onScan,
  onClear,
}) => {
  const theme = useTheme();
  const [scannerOpen, setScannerOpen] = useState(false);
  const scannerResultHandlerRef = useRef<((code: string) => void) | null>(null);

  const handleScannerOpen = () => {
    setScannerOpen(true);
    scannerResultHandlerRef.current = (code: string) => {
      onScan(code);
      setScannerOpen(false);
      scannerResultHandlerRef.current = null;
    };
  };

  const handleScannerClose = () => {
    setScannerOpen(false);
    scannerResultHandlerRef.current = null;
  };

  return (
    <View>
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
        <TouchableOpacity
          style={styles.scannerButton}
          onPress={handleScannerOpen}
          activeOpacity={0.7}
        >
          <Icon name="qrcode-scan" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Full-bleed scanner modal */}
      {scannerOpen && (
        <View style={styles.scannerDockFull} pointerEvents="box-none">
        <View style={styles.scannerFullBleed}>
          <CameraView
            style={styles.camera}
            facing="back"
            onBarcodeScanned={(result: any) => {
              const code = result?.data || result?.rawValue;
              if (code && scannerResultHandlerRef.current) {
                scannerResultHandlerRef.current(code);
              }
            }}
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
            }}
          />
          <TouchableOpacity
            onPress={handleScannerClose}
            style={styles.scannerClose}
          >
            <Icon name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
      )}
      
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
        elevation: 2,
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
  scannerButton: {
    borderRadius: 8,
    backgroundColor: "#93C822",
    padding: 8,
    marginLeft: 8,
  },
  scannerDockFull: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5000 },
  scannerFullBleed: { backgroundColor: '#000', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  scannerClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SearchBarWithScanner;
