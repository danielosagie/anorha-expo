import React, { useState, useRef, memo } from 'react';
import { View, Text, StyleSheet, FlatList, Image, Dimensions, TouchableOpacity, SafeAreaView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp } from 'react-native-reanimated';
import Button from '../components/Button';

const { width, height } = Dimensions.get('window');

const slides = [
  {
    id: '1',
    title: 'Migrate Anywhere,\nSync Everywhere',
    description: 'Connect your Shopify, Amazon, and other marketplace accounts to sync inventory in real time.',
    image: require('../assets/SellEverywhere.png'),
  },
  {
    id: '2',
    title: 'List Everywhere\nFaster Than Ever',
    description: 'List your products on multiple marketplaces with just a few taps through our unified dashboard.',
    image: require('../assets/scanner.png'),
  },
  {
    id: '3',
    title: 'Partner & Scale\nYour Business',
    description: 'Sell, buy, and share inventory with anyone through our secure B2B marketplace.',
    image: require('../assets/orbit.png'),
  }
];

const OnboardingSlide = memo(({ item }: { item: any }) => (
  <View style={styles.slide}>
    <Animated.View entering={FadeInUp.duration(1000).springify()}>
      <View style={styles.imageCard}>
        <Image
          source={item.image}
          style={styles.image}
          resizeMode="contain"
        />
      </View>
    </Animated.View>
    <View style={styles.textContainer}>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.description}>{item.description}</Text>
    </View>
  </View>
));

const OnboardingSlides = ({ navigation }: { navigation: any }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<any>(null);
  const insets = useSafeAreaInsets();

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current.scrollToIndex({
        index: currentIndex + 1,
        animated: true
      });
      setCurrentIndex(currentIndex + 1);
    } else {
      navigation.navigate('Auth');
    }
  };

  const handleSkip = () => {
    navigation.navigate('Auth');
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleSkip} style={styles.skipPill}>
            <Text style={styles.skipButton}>Skip</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          ref={flatListRef}
          data={slides}
          renderItem={({ item }) => <OnboardingSlide item={item} />}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          onMomentumScrollEnd={(event) => {
            const index = Math.round(event.nativeEvent.contentOffset.x / width);
            setCurrentIndex(index);
          }}
        />

        <View style={[styles.footer, { paddingBottom: 40 + insets.bottom }]}>
          <View style={styles.pagination}>
            {slides.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  index === currentIndex ? styles.activeDot : null
                ]}
              />
            ))}
          </View>

          <Button
            title={currentIndex === slides.length - 1 ? "Let's get started" : "Continue"}
            onPress={handleNext}
            style={styles.button}
            textStyle={styles.buttonText}
          />
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F7F4',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    width: '100%',
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'flex-end',
  },
  skipPill: {
    backgroundColor: '#18181B',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  skipButton: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  slide: {
    width,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageCard: {
    width: width * 0.85,
    height: height * 0.35,
    maxHeight: height * 0.35,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
    marginBottom: 24,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 36,
  },
  description: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 21,
  },
  footer: {
    width: '100%',
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D4D4D8',
    marginHorizontal: 5,
  },
  activeDot: {
    backgroundColor: '#93C822',
    width: 22,
    borderRadius: 4,
  },
  button: {
    backgroundColor: '#93C822',
    borderRadius: 16,
    paddingVertical: 15,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  }
});

export default OnboardingSlides;
