import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  barcode: string;
  onChangeBarcode: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  loading?: boolean;
  errorMessage?: string;
};

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const BarcodeEntrySheet: React.FC<Props> = ({
  visible,
  barcode,
  onChangeBarcode,
  onSubmit,
  onCancel,
  loading = false,
  errorMessage,
}) => {
  const handleDigitPress = (digit: string) => {
    if (loading) return;
    onChangeBarcode(barcode + digit);
  };

  const handleBackspace = () => {
    if (loading) return;
    onChangeBarcode(barcode.slice(0, -1));
  };

  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoider}
        >
          <View style={[styles.sheet, { maxHeight: '85%' }]}>
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={onCancel} disabled={loading}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Enter barcode</Text>
              <TouchableOpacity
                onPress={onSubmit}
                disabled={loading || !barcode.trim()}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#111827" />
                ) : (
                  <Text
                    style={[
                      styles.addText,
                      (!barcode.trim() || loading) && styles.addTextDisabled,
                    ]}
                  >
                    Search
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
            >
              <View style={styles.inputWrapper}>
                <TextInput
                  value={barcode}
                  onChangeText={onChangeBarcode}
                  placeholder="0000000000000"
                  keyboardType="number-pad"
                  maxLength={20}
                  style={styles.input}
                />
              </View>

              {errorMessage ? (
                <Text style={styles.errorText}>{errorMessage}</Text>
              ) : null}

              <View style={styles.keypad}>
                <View style={styles.keypadRow}>
                  {DIGITS.slice(0, 3).map((d) => (
                    <KeypadButton key={d} label={d} onPress={() => handleDigitPress(d)} />
                  ))}
                </View>
                <View style={styles.keypadRow}>
                  {DIGITS.slice(3, 6).map((d) => (
                    <KeypadButton key={d} label={d} onPress={() => handleDigitPress(d)} />
                  ))}
                </View>
                <View style={styles.keypadRow}>
                  {DIGITS.slice(6, 9).map((d) => (
                    <KeypadButton key={d} label={d} onPress={() => handleDigitPress(d)} />
                  ))}
                </View>
                <View style={styles.keypadRow}>
                  <View style={{ flex: 1 }} />
                  <KeypadButton
                    label={DIGITS[9]}
                    onPress={() => handleDigitPress(DIGITS[9])}
                  />
                  <KeypadButton label="⌫" onPress={handleBackspace} />
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const KeypadButton: React.FC<{ label: string; onPress: () => void }> = ({
  label,
  onPress,
}) => {
  return (
    <TouchableOpacity style={styles.keypadButton} onPress={onPress}>
      <Text style={styles.keypadButtonText}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'flex-end',
  },
  keyboardAvoider: {
    width: '100%',
  },
  topContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#F9FAFB',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#D1D5DB',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cancelText: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  addText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  addTextDisabled: {
    color: '#D1D5DB',
  },
  inputWrapper: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  input: {
    fontSize: 18,
    letterSpacing: 2,
    color: '#111827',
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    marginBottom: 8,
  },
  keypad: {
    marginTop: 8,
    gap: 8,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  keypadButton: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keypadButtonText: {
    fontSize: 20,
    fontWeight: '500',
    color: '#111827',
  },
});

export default BarcodeEntrySheet;

