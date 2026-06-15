import React, { useMemo, useState } from 'react';
import { View, Text, Dimensions, TouchableOpacity, StyleSheet, Image, LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { createLogger } from '../utils/logger';
const log = createLogger('PyramidGrid');


// It's better to define the shape of the objects you expect.
// This gives you type safety and autocomplete.
interface GridItem {
  id: string;
  uri: string;
}

const PyramidGrid = ( { items, style }: { items: GridItem[], style?: StyleProp<ViewStyle> } ) => {
  const screenWidth = Dimensions.get('window').width;
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w && w !== containerWidth) setContainerWidth(w);
  };
  const availableWidth = useMemo(() => {
    // Prefer measured width; fallback to explicit style width; else screen width
    if (containerWidth && containerWidth > 0) return containerWidth;
    const flat = StyleSheet.flatten(style) as ViewStyle | undefined;
    const fromStyle = typeof flat?.width === 'number' ? flat?.width : undefined;
    return (fromStyle && fromStyle > 0) ? fromStyle : screenWidth;
  }, [containerWidth, style, screenWidth]);

  // State to manage whether to show the full list or only the top 6
  const [showFullList, setShowFullList] = useState(false);

  // Function to determine items per row for pyramid shape
  const getPyramidRows = (totalItems: number) => {
    const rows = [];
    totalItems = items.length;
    let itemsRemaining = totalItems;
    let currentRowItems = 1; // Start with 1 item in the first row

    while (itemsRemaining > 0) {
      const itemsToAdd = Math.min(currentRowItems, itemsRemaining);
      rows.push(itemsToAdd);
      itemsRemaining -= itemsToAdd;
      // Adjust this logic for different pyramid shapes (e.g., 1, 2, 3...)
      // For a more gradual increase: currentRowItems += 1;
      // For a sharper increase: currentRowItems += 2;
      currentRowItems += 1;
    }
    return rows;
  };

  // Determine which items to display based on the 'showFullList' state
  const itemsToDisplay = showFullList ? items : items.slice(0, 6); // Limiting to top 6

  const pyramidRows = getPyramidRows(itemsToDisplay.length);
  let itemIndex = 0;

  // Calculate the maximum number of items in any given row to normalize width
  const maxItemsInAnyRow = Math.max(...pyramidRows, 1);

  return (
    <View style={[styles.container, style]} onLayout={onLayout}>
      {pyramidRows.map((numItemsInRow, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {Array.from({ length: numItemsInRow }).map((_, colIndex) => {
            const item = itemsToDisplay[itemIndex];
            itemIndex++;

            // Calculate item width for responsiveness based on screenWidth and numItemsInRow
            // Using maxItemsInAnyRow for a more consistent item size across rows
            // Ensure minimum size for visibility
            const calculatedWidth = (availableWidth / (maxItemsInAnyRow + 1)) * 0.9;
            const itemWidth = Math.max(calculatedWidth, 80); // Minimum 80px width
            
            log.debug(`[PYRAMID] Row ${rowIndex}, Item ${colIndex}: width=${itemWidth}, availableWidth=${availableWidth}, maxItems=${maxItemsInAnyRow}`);

            return (
              <View
                key={item ? item.id : `${rowIndex}-${colIndex}`}
                style={{ ...styles.item, width: itemWidth, height: itemWidth }}
              >
                {/* The error was here. You cannot render an entire {item} object inside a <Text> tag.
                    Instead, we render an <Image> component and use the item's `uri` property. */}
                {item && item.uri ? (
                  <Image 
                    source={{ uri: item.uri }} 
                    style={styles.itemImage}
                    onError={() => log.debug(`[PYRAMID] Failed to load image: ${item.uri}`)}
                    onLoad={() => log.debug(`[PYRAMID] Successfully loaded image: ${item.uri?.substring(0, 50)}`)}
                  />
                ) : (
                  <View style={[styles.itemImage, { backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ fontSize: 12, color: '#999' }}>No Image</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}

      {/* Show/Hide button */}
      {items.length > 6 && ( // Only show the button if there are more than 6 items
        <TouchableOpacity
          onPress={() => setShowFullList(!showFullList)}
          style={styles.button}
        >
          <Text>
            {showFullList ? 'Show Top 6' : `Show All (${items.length})`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default PyramidGrid;


const styles = StyleSheet.create({
  container: {
    //flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    //backgroundColor: 'black',
    //backgroundColor: 'blue',
  },    
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center', // Align items nicely in the center of the row
    //backgroundColor: 'green',
  },
  item: {
    // Using flexGrow here can interfere with manually set widths.
    // Let's use a margin for spacing instead.
    margin: 2,
    //backgroundColor: 'yellow',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemText: {
    color: 'white',
  },
  itemImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8, // Make the images look nicer with rounded corners
    backgroundColor: 'eee', // A light background color while the image loads
  },
  button: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'gray',
    borderRadius: 5,
  },
});