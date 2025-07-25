import React, { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native'; 
import { View, Text, Pressable } from 'react-native';

function MatchSelectionScreen() {
    const navigation = useNavigation();

    useEffect(() => {
        navigation.setOptions({
            headerShown: false,
        });
    }, [navigation]);

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text>Match Selection Screen</Text>
        </View>
    )
}

export default MatchSelectionScreen;