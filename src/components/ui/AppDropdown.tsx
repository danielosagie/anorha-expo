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
            maxHeight={300}
            labelField={labelField}
            valueField={valueField}
            placeholder={placeholder}
            value={value}
            activeColor="#F0F9FF"
            dropdownPosition="bottom" // Forces the dropdown to open underneath
            onChange={onChange}
            {...props}
        />
    );
};

const styles = StyleSheet.create({
    dropdown: {
        height: 50,
        backgroundColor: 'transparent',
        borderColor: '#E5E7EB',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
    },
    container: {
        backgroundColor: 'white',
        borderRadius: 12,
        marginTop: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
        padding: 4,
        borderWidth: 0,
        overflow: 'hidden', // Ensures border radius is respected
    },
    itemContainer: {
        borderRadius: 8,
        marginVertical: 2,
        paddingHorizontal: 8,
    },
    itemText: {
        fontSize: 14,
        color: '#374151',
    },
    placeholder: {
        fontSize: 14,
        color: '#9CA3AF',
    },
    selectedText: {
        fontSize: 14,
        color: '#000',
        fontWeight: '500',
    },
    icon: {
        width: 20,
        height: 20,
        tintColor: '#6B7280',
    },
});
