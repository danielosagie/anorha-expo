import React from 'react';
import { View, Text } from 'react-native';
import { styles } from './styles';

export const SectionHeader = ({ title, icon, rightAction }: { title: string, icon?: any, rightAction?: React.ReactNode }) => {
  const IconComp = icon;
  return (
    <View style={styles.sectionHeaderContainer}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {IconComp && (
          <View style={styles.sectionIconBg}>
            <IconComp size={16} color="#4B5563" />
          </View>
        )}
        <Text style={styles.sectionHeaderTitle}>{title}</Text>
      </View>
      {rightAction}
    </View>
  );
};
