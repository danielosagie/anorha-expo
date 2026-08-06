import React, { memo, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { ShelfItemBox } from '../../features/cart/types';

type ImageSize = { width: number; height: number };

type ShelfItemCropProps = {
  uri: string;
  box: ShelfItemBox;
  width: number;
  height: number;
  borderRadius: number;
};

const validSize = (width?: number, height?: number): ImageSize | null =>
  typeof width === 'number' && Number.isFinite(width) && width > 0
    && typeof height === 'number' && Number.isFinite(height) && height > 0
    ? { width, height }
    : null;

const validBox = (box: ShelfItemBox): boolean => (
  Number.isFinite(box.x)
  && Number.isFinite(box.y)
  && Number.isFinite(box.width)
  && Number.isFinite(box.height)
  && box.x >= 0
  && box.y >= 0
  && box.width > 0
  && box.height > 0
  && box.x < 1
  && box.y < 1
);

export const ShelfItemCrop = memo(function ShelfItemCrop({
  uri,
  box,
  width,
  height,
  borderRadius,
}: ShelfItemCropProps) {
  const storedSize = validSize(box.sourceWidth, box.sourceHeight);
  const [imageSize, setImageSize] = useState<ImageSize | null>(storedSize);

  useEffect(() => {
    const nextStoredSize = validSize(box.sourceWidth, box.sourceHeight);
    if (nextStoredSize) {
      setImageSize(nextStoredSize);
      return;
    }

    let active = true;
    Image.getSize(
      uri,
      (sourceWidth, sourceHeight) => {
        if (active) setImageSize(validSize(sourceWidth, sourceHeight));
      },
      () => {
        if (active) setImageSize(null);
      },
    );
    return () => { active = false; };
  }, [box.sourceHeight, box.sourceWidth, uri]);

  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const safeBorderRadius = Number.isFinite(borderRadius) && borderRadius >= 0 ? borderRadius : 0;
  const containerStyle = useMemo(
    () => ({ width: safeWidth, height: safeHeight, borderRadius: safeBorderRadius }),
    [safeBorderRadius, safeHeight, safeWidth],
  );
  const imageStyle = useMemo(() => {
    if (!imageSize || !validBox(box)) return null;
    const cropWidth = box.width * imageSize.width;
    const cropHeight = box.height * imageSize.height;
    if (![cropWidth, cropHeight].every(Number.isFinite) || cropWidth <= 0 || cropHeight <= 0) return null;

    const scale = Math.max(safeWidth / cropWidth, safeHeight / cropHeight);
    const scaledCropWidth = cropWidth * scale;
    const scaledCropHeight = cropHeight * scale;
    const translateX = (safeWidth - scaledCropWidth) / 2 - box.x * imageSize.width * scale;
    const translateY = (safeHeight - scaledCropHeight) / 2 - box.y * imageSize.height * scale;
    const renderedWidth = imageSize.width * scale;
    const renderedHeight = imageSize.height * scale;
    if (![scale, scaledCropWidth, scaledCropHeight, translateX, translateY, renderedWidth, renderedHeight].every(Number.isFinite)) {
      return null;
    }

    return {
      width: renderedWidth,
      height: renderedHeight,
      transform: [{ translateX }, { translateY }],
    };
  }, [box, imageSize, safeHeight, safeWidth]);

  return (
    <View style={[styles.container, containerStyle]}>
      {imageStyle
        ? <Image source={{ uri }} style={imageStyle} />
        : <Image source={{ uri }} style={styles.fallbackImage} resizeMode="cover" />}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#ECEDE8',
  },
  fallbackImage: {
    width: '100%',
    height: '100%',
  },
});
