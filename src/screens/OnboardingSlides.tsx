import React, { useState, useRef, memo } from 'react';
import { View, Text, StyleSheet, FlatList, Image, Dimensions, TouchableOpacity, SafeAreaView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp } from 'react-native-reanimated';
import Button from '../components/Button';
import ShadowSurface from '../components/ui/ShadowSurface';

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
      <ShadowSurface shadow="md" radius={32} style={styles.imageShadow} innerStyle={styles.imageContainer}>
        <Image
          source={item.image}
          style={styles.image}
          resizeMode="contain"
        />
      </ShadowSurface>
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
          <TouchableOpacity onPress={handleSkip}>
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
    backgroundColor: '#FEF4DD', // Off-white/Creamy background
  },
  safeArea: {
    flex: 1,
  },
  header: {
    width: '100%',
    padding: 24,
    alignItems: 'flex-end',
  },
  skipButton: {
    color: '#666',
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  slide: {
    width,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 10,
  },
  imageShadow: {
    width: width * 0.85,
    height: height * 0.35,
    maxHeight: height * 0.35,
    marginBottom: 10,
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
    fontSize: 32,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#313131ff',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 40,
  },
  description: {
    fontSize: 17,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: '#666',
    textAlign: 'center',
    lineHeight: 26,
  },
  footer: {
    width: '100%',
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  pagination: {
    flexDirection: 'row',
    marginBottom: 32,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E5E5',
    marginHorizontal: 5,
  },
  activeDot: {
    backgroundColor: '#5c9c00',
    width: 24,
  },
  button: {
    backgroundColor: '#5c9c00',
    borderRadius: 16,
    height: 60,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_700Bold',
  }
});

export default OnboardingSlides; 
