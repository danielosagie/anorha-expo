/**
 * Web-only PagerView: ScrollView with paging. Never imports react-native-pager-view.
 * Used when Platform.OS === 'web' via Metro's .web.tsx resolution.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, View, ViewStyle, LayoutChangeEvent, Dimensions } from 'react-native';

const getInitialWidth = () => Dimensions.get('window').width;

export interface AppPagerViewProps {
  style?: ViewStyle;
  initialPage?: number;
  onPageSelected?: (e: { nativeEvent: { position: number } }) => void;
  children?: React.ReactNode;
}

export default function AppPagerView({ style, initialPage = 0, onPageSelected, children }: AppPagerViewProps) {
  const [pageWidth, setPageWidth] = useState(getInitialWidth);
  const [currentPage, setCurrentPage] = useState(initialPage);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setPageWidth(w);
  }, []);

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      if (pageWidth <= 0) return;
      const page = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      if (page !== currentPage) {
        setCurrentPage(page);
        onPageSelected?.({ nativeEvent: { position: page } });
      }
    },
    [pageWidth, currentPage, onPageSelected]
  );

  return (
    <ScrollView
      style={style}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onLayout={onLayout}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentOffset={pageWidth > 0 && initialPage > 0 ? { x: initialPage * pageWidth, y: 0 } : undefined}
    >
      {React.Children.map(children, (child) => (
        <View style={{ width: pageWidth || '100%' }}>{child}</View>
      ))}
    </ScrollView>
  );
}
