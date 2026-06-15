import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { styles } from './styles';
import { SectionHeader } from './SectionHeader';

export const CollapsibleSection = ({
  title,
  icon,
  children,
  defaultOpen = true,
  rightAction,
  errorCount = 0
}: {
  title: string,
  icon?: any,
  children: React.ReactNode,
  defaultOpen?: boolean,
  rightAction?: React.ReactNode,
  errorCount?: number
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
      <TouchableOpacity
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 16,
          backgroundColor: '#fff',
          justifyContent: 'space-between'
        }}
        onPress={() => setIsOpen(v => !v)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <SectionHeader title={title} icon={icon} />
          {errorCount > 0 && (
            <View style={{ backgroundColor: '#FECACA', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ color: '#DC2626', fontSize: 10, fontWeight: '700' }}>{errorCount} MISSING</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {rightAction}
          <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#9CA3AF" />
        </View>
      </TouchableOpacity>

      {isOpen && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <View style={{ height: 1, backgroundColor: '#F3F4F6', marginBottom: 16 }} />
          {children}
        </View>
      )}
    </View>
  );
};
