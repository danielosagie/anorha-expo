/**
 * Native-only PagerView: uses react-native-pager-view on iOS/Android.
 * For web, Metro resolves to AppPagerView.web.tsx which never imports this.
 */
import React from 'react';
import PagerView from 'react-native-pager-view';

export interface AppPagerViewProps {
  style?: any;
  initialPage?: number;
  onPageSelected?: (e: { nativeEvent: { position: number } }) => void;
  children?: React.ReactNode;
}

export default function AppPagerView({ style, initialPage = 0, onPageSelected, children }: AppPagerViewProps) {
  return (
    <PagerView style={style} initialPage={initialPage} onPageSelected={onPageSelected}>
      {children}
    </PagerView>
  );
}
