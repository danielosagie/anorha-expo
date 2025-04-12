import React, { useState, useRef, memo } from 'react';
import { View, Text, StyleSheet, FlatList, Image, Dimensions, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Button from '../components/Button';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';

const { width } = Dimensions.get('window');

const slides = [
  {
    id: '1',
    title: 'Migrate Anywhere, Sync Everywhere',
    description: 'Connect your Shopify, Amazon, and other marketplace accounts to sync inventory in real time.',
    image: require('../assets/SellEverywhere.png'),
  },
  {
    id: '2',
    title: 'List Everywhere Faster',
    description: 'List your products on multiple marketplaces with just a few taps.',
    image: require('../assets/scanner.png'),
  },
  {
    id: '3',
    title: 'Partner & Work Together',
    description: 'Sell, Buy, & Share Inventory w/ anyone through our marketplace.',
    image: require('../assets/orbit.png'),
  }
];

const OnboardingSlide = memo(({ item }: { item: SlideData }) => (
  <View style={styles.slide}>
    <Image 
      source={item.image} 
      style={styles.image}
      resizeMode="contain"
    />
    <Text style={styles.title}>{item.title}</Text>
    <Text style={styles.description}>{item.description}</Text>
  </View>
));

const OnboardingSlides = ({ navigation }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef(null);
  
  const renderItem = ({ item }) => {
    return (
      <OnboardingSlide item={item} />
    );
  };
  
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
      <AnimatedGradientBackground style={StyleSheet.absoluteFill} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={handleSkip}>
          <Text style={styles.skipButton}>Skip</Text>
        </TouchableOpacity>
      </View>
      
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / width);
          setCurrentIndex(index);
        }}
      />
      
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
      
      <View style={styles.footer}>
        <Button 
          title={currentIndex === slides.length - 1 ? "Get Started" : "Next"} 
          onPress={handleNext} 
          style={styles.button} 
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    padding: 16,
    alignItems: 'flex-end',
    marginTop: 40,
  },
  skipButton: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  slide: {
    width,
    alignItems: 'center',
    paddingBottom: 70,

  },
  image: {
    width: 400,
    height: 600,
  },
  image2: {
    width: 200,
    height: 200,
    marginVertical: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 24,
  },
  pagination: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.4)',
    marginHorizontal: 4,
  },
  activeDot: {
    backgroundColor: 'white',
    width: 20,
  },
  footer: {
    width: '100%',
    paddingHorizontal: 24,
    marginBottom: 40,
  },
  button: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default OnboardingSlides; 