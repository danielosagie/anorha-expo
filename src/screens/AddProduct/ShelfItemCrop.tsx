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
  typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0
    ? { width, height }
    : null;

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

  const containerStyle = useMemo(() => ({ width, height, borderRadius }), [borderRadius, height, width]);
  const imageStyle = useMemo(() => {
    if (!imageSize) return null;
    const cropWidth = box.width * imageSize.width;
    const cropHeight = box.height * imageSize.height;
    if (cropWidth <= 0 || cropHeight <= 0) return null;

    const scale = Math.max(width / cropWidth, height / cropHeight);
    const scaledCropWidth = cropWidth * scale;
    const scaledCropHeight = cropHeight * scale;
    const translateX = (width - scaledCropWidth) / 2 - box.x * imageSize.width * scale;
    const translateY = (height - scaledCropHeight) / 2 - box.y * imageSize.height * scale;

    return {
      width: imageSize.width * scale,
      height: imageSize.height * scale,
      transform: [{ translateX }, { translateY }],
    };
  }, [box.height, box.width, box.x, box.y, height, imageSize, width]);

  return (
    <View style={[styles.container, containerStyle]}>
      {imageStyle ? <Image source={{ uri }} style={imageStyle} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#ECEDE8',
  },
});

