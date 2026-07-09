import React from 'react';
import { StyleSheet, View, Text, ViewStyle, TextStyle, ImageStyle } from 'react-native';
import { Dropdown as ElementDropdown } from 'react-native-element-dropdown';

interface AppDropdownProps {
    data: any[];
    value: any;
    onChange: (item: any) => void;
    labelField?: string;
    valueField?: string;
    placeholder?: string;
    style?: ViewStyle | ViewStyle[];
    containerStyle?: ViewStyle;
    placeholderStyle?: TextStyle;
    selectedTextStyle?: TextStyle;
    iconStyle?: ImageStyle;
    showIcon?: boolean;
    search?: boolean;
    searchPlaceholder?: string;
    onChangeText?: (text: string) => void;
    renderItem?: (item: any, selected?: boolean) => React.ReactElement | null;
    maxHeight?: number;
}

export const AppDropdown: React.FC<AppDropdownProps> = ({
    data,
    value,
    onChange,
    labelField = 'label',
    valueField = 'value',
    placeholder = 'Select option',
    style,
    containerStyle,
    placeholderStyle,
    selectedTextStyle,
    iconStyle,
    ...props
}) => {
    return (
        <ElementDropdown
            style={[styles.dropdown, style]}
            containerStyle={[styles.container, containerStyle]}
            placeholderStyle={[styles.placeholder, placeholderStyle]}
            selectedTextStyle={[styles.selectedText, selectedTextStyle]}
            itemContainerStyle={styles.itemContainer}
            itemTextStyle={styles.itemText}
            iconStyle={[styles.icon, iconStyle]}
            data={data}
            maxHeight={props.maxHeight || 300}
            labelField={labelField}
            valueField={valueField}
            placeholder={placeholder}
            value={value}
            activeColor="#F2F2F2"
            dropdownPosition="bottom" // Forces the dropdown to open underneath
            onChange={onChange}
            {...props}
        />
    );
};

const styles = StyleSheet.create({
    dropdown: {
        height: 50,
        backgroundColor: '#FFFFFF',
        borderColor: '#E5E7EB',
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 14,
    },
    container: {
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
        marginTop: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 16,
        padding: 8,
        borderWidth: 0,
        overflow: 'hidden', // Ensures border radius is respected
    },
    itemContainer: {
        borderRadius: 14,
        marginVertical: 1,
        paddingHorizontal: 6,
    },
    itemText: {
        fontSize: 16,
        color: '#18181B',
        fontFamily: 'Inter_600SemiBold',
    },
    placeholder: {
        fontSize: 14,
        color: '#9CA3AF',
    },
    selectedText: {
        fontSize: 14,
        color: '#18181B',
        fontFamily: 'Inter_500Medium',
        fontWeight: '500',
    },
    icon: {
        width: 20,
        height: 20,
        tintColor: '#6B7280',
    },
});
