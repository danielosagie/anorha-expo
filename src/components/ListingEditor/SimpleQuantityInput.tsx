import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import { styles } from './styles';

export function SimpleQuantityInput({ quantity, onChangeQuantity }: { quantity: number; onChangeQuantity: (qty: number) => void }) {
  const [localQty, setLocalQty] = useState(String(quantity));
  const timeoutRef = React.useRef<any>(null);
  const isEditingRef = React.useRef(false);

  useEffect(() => {
    // Only sync from prop if user is NOT actively editing
    if (!isEditingRef.current) {
      console.log('[SimpleQuantityInput] Syncing from prop:', quantity);
      setLocalQty(String(quantity));
    } else {
      console.log('[SimpleQuantityInput] User is editing, not syncing from prop:', quantity);
    }
  }, [quantity]);

  const handleChange = (text: string) => {
    console.log('[SimpleQuantityInput] handleChange:', text);
    isEditingRef.current = true;
    const num = text.replace(/[^0-9]/g, '');
    setLocalQty(num);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      console.log('[SimpleQuantityInput] Calling onChangeQuantity with:', Number(num || '0'));
      onChangeQuantity(Number(num || '0'));
      isEditingRef.current = false;
    }, 300);
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: '#000' }}>Quantity:</Text>
      <TextInput
        style={styles.qtyInput}
        value={localQty}
        onChangeText={handleChange}
        onBlur={() => {
          isEditingRef.current = false;
          // Sync to prop value on blur to ensure consistency
          setLocalQty(String(quantity));
        }}
        placeholder="0"
        keyboardType="numeric"
      />
    </View>
  );
}
