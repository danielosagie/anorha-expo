import React, { useState, useEffect } from 'react';
import { Keyboard, Platform, ViewStyle } from 'react-native';
import BottomActionBar from './BottomActionBar';

type Props = React.ComponentProps<typeof BottomActionBar> & {
    /** If false, the bar is hidden regardless of keyboard state. Default true. */
    visible?: boolean;
};

/**
 * A wrapper around BottomActionBar that automatically hides itself when the keyboard is open.
 * This moves the keyboard listener logic into a leaf component to prevent re-rendering
 * the entire parent screen (e.g. GenerateDetailsScreen) on keyboard toggle.
 */
export default function KeyboardAwareBottomActionBar({ visible = true, ...props }: Props) {
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

    useEffect(() => {
        const showSub = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            () => setIsKeyboardVisible(true)
        );
        const hideSub = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
            () => setIsKeyboardVisible(false)
        );
        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    if (!visible || isKeyboardVisible) {
        return null;
    }

    return <BottomActionBar {...props} />;
}
