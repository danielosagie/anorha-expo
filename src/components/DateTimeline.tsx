import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';

interface DateTimelineProps {
    selectedDate: Date;
    onSelectDate: (date: Date) => void;
    activeDates?: string[]; // ISO strings of dates that have activity
}

export const DateTimeline: React.FC<DateTimelineProps> = ({ selectedDate, onSelectDate, activeDates = [] }) => {
    // Generate last 14 days
    const dates = React.useMemo(() => {
        const result = [];
        const today = new Date();
        for (let i = 0; i < 14; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            result.push(d);
        }
        return result.reverse(); // Oldest to newest (left to right? No, typically newest is right or left. Let's do newest right)
    }, []);

    // Format helpers
    const getDayName = (d: Date) => {
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return 'Today';
        return d.toLocaleDateString('en-US', { weekday: 'short' });
    };

    const isSelected = (d: Date) => d.toDateString() === selectedDate.toDateString();

    return (
        <View style={styles.wrapper}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.container}
            >
                {/* Reversing the array again to put Today first for the ScrollView render order */}
                {[...dates].reverse().map((date, index) => {
                    const active = isSelected(date);
                    const dayNum = date.getDate();
                    const hasActivity = activeDates.includes(date.toISOString().split('T')[0]);

                    return (
                        <TouchableOpacity
                            key={index}
                            style={[
                                styles.dayItem,
                                active && styles.activeItem
                            ]}
                            onPress={() => onSelectDate(date)}
                        >
                            <Text style={[styles.dayName, active && styles.activeText]}>
                                {getDayName(date)}
                            </Text>
                            <View style={[styles.dayBubble, active && styles.activeBubble]}>
                                <Text style={[styles.dayNum, active && styles.activeBubbleText]}>
                                    {dayNum}
                                </Text>
                                {/* Activity Dot */}
                                {hasActivity && !active && <View style={styles.activityDot} />}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        marginVertical: 12,
    },
    container: {
        paddingHorizontal: 16,
        gap: 12,
    },
    dayItem: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 4,
        minWidth: 50,
    },
    activeItem: {
        // No background change for whole item, just the bubble usually.
    },
    dayName: {
        fontSize: 12,
        color: '#9ca3af',
        marginBottom: 8,
        fontWeight: '500',
    },
    activeText: {
        color: '#111827',
        fontWeight: '600',
    },
    dayBubble: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#f3f4f6', // grey-100
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    activeBubble: {
        backgroundColor: '#111827', // black or primary
    },
    dayNum: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    activeBubbleText: {
        color: '#ffffff',
    },
    activityDot: {
        position: 'absolute',
        bottom: -4,
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#84cc16', // lime-500
    },
});
