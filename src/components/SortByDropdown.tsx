import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Modal,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

export interface SortOption {
  value: string;
  label: string;
}

interface SortByDropdownProps {
  sortBy: string;
  onSortChange: (sortValue: string) => void;
  options?: SortOption[];
  /** Render a compact circular icon button (sits to the right of the search bar). */
  compact?: boolean;
}

export const DEFAULT_SORT_OPTIONS: SortOption[] = [
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'price-low', label: 'Price (Low to High)' },
  { value: 'price-high', label: 'Price (High to Low)' },
  { value: 'stock-low', label: 'Stock (Low to High)' },
  { value: 'stock-high', label: 'Stock (High to Low)' },
  { value: 'date', label: 'Recently Added' },
];

const SortByDropdown: React.FC<SortByDropdownProps> = ({
  sortBy,
  onSortChange,
  options = DEFAULT_SORT_OPTIONS,
  compact = false,
}) => {
  const theme = useTheme();
  const [isModalVisible, setIsModalVisible] = useState(false);

  const currentOption = options.find((opt) => opt.value === sortBy);
  const displayLabel = currentOption?.label || 'Sort By';

  const handleSelectSort = (value: string) => {
    onSortChange(value);
    setIsModalVisible(false);
  };

  return (
    <>
      {compact ? (
        <TouchableOpacity style={styles.compactBtn} onPress={() => setIsModalVisible(true)} activeOpacity={0.7}>
          <Icon name="sort" size={20} color="#3F3F46" />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.dropdownButton, { borderColor: theme.colors.textSecondary + '40' }]}
          onPress={() => setIsModalVisible(true)}
          activeOpacity={0.7}
        >
          <View style={styles.dropdownContent}>
            <Icon name="sort" size={18} color={theme.colors.textSecondary} />

            <Text style={[styles.dropdownText, { color: theme.colors.text }]}>
              {displayLabel}
            </Text>

          </View>
          {/*<Icon name="chevron-down" size={18} color={theme.colors.textSecondary} />*/}
        </TouchableOpacity>
      )}

      <Modal
        animationType="fade"
        transparent={true}
        visible={isModalVisible}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.centeredView}
          activeOpacity={1}
          onPressOut={() => setIsModalVisible(false)}
        >
          <View
            style={[styles.modalView, { backgroundColor: theme.colors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
              Sort By
            </Text>

            {options.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.sortOption,
                  sortBy === option.value && {
                    backgroundColor: theme.colors.primary + '15',
                  },
                ]}
                onPress={() => handleSelectSort(option.value)}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    { color: theme.colors.text },
                    sortBy === option.value && {
                      fontWeight: '600',
                      color: theme.colors.primary,
                    },
                  ]}
                >
                  {option.label}
                </Text>
                {sortBy === option.value && (
                  <Icon
                    name="check"
                    size={20}
                    color={theme.colors.primary}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  compactBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownButton: {

    alignSelf: "flex-start",
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 8,
  },
  dropdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownText: {
    marginLeft: 8,
    fontSize: 15,
    fontWeight: '500',
  },
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    width: '80%',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  sortOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  sortOptionText: {
    fontSize: 15,
    fontWeight: '500',
  },
});

export default SortByDropdown;
