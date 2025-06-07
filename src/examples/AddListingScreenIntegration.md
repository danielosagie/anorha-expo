# Integrating VisionCamera into AddListingScreen

This document provides instructions for integrating the VisionCamera component into your existing AddListingScreen.

## Steps to Integrate

1. **Replace the Camera Implementation**

   In your AddListingScreen.tsx, you'll need to make these changes:

   - Import the VisionCamera component and hook
   ```typescript
   import VisionCamera from '../components/VisionCamera';
   import useVisionCamera from '../hooks/useVisionCamera';
   ```

   - Replace the current camera implementation with the VisionCamera hook
   ```typescript
   // Find where you handle camera functionality in AddListingScreen
   // Replace with:
   const { 
     showCamera, 
     initialMedia, 
     openCamera, 
     closeCamera, 
     handleMediaCaptured 
   } = useVisionCamera(handleMediaCaptured);
   ```

   - Update your UI to conditionally render the VisionCamera component
   ```typescript
   {showCamera ? (
     <VisionCamera
       onCapture={handleMediaCaptured}
       onClose={closeCamera}
       initialMedia={capturedMedia} // Use your existing media state
       styles={{}} // Pass any custom styles you need
     />
   ) : (
     // Your existing UI
   )}
   ```

   - Update your image capture button handler
   ```typescript
   const handleOpenCamera = () => {
     openCamera(capturedMedia); // Pass your existing media
   };
   ```

2. **Replace Existing Camera Methods**

   You should be able to remove these methods from your AddListingScreen as they are now handled by the VisionCamera component:
   - `takePicture`
   - `startRecording`
   - `stopRecording`
   - `toggleCameraMode`
   - `toggleFlash`
   - `toggleCameraFacing`
   - Any other camera-specific methods

3. **Update Camera Section**

   If you have a separate CameraSection component (which was referenced in your code outline), you can:
   - Either replace it with the VisionCamera component
   - Or update its implementation to use VisionCamera internally

4. **Handling Permissions**

   The permissions are now handled within the `useVisionCamera` hook, so you can remove any separate permission handling code.

5. **Barcode Scanner Integration**

   The VisionCamera component now includes barcode scanning functionality. When a barcode is detected:
   - It will display an overlay with the barcode value
   - You can customize what happens when a barcode is detected by modifying the VisionCamera component

6. **Product Detection**

   The product detection functionality:
   - Shows a bounding box around detected products
   - Shows a confidence score
   - Highlights the capture button when a product is detected with high confidence
   - You can customize the detection logic by modifying the ProductDetectionProcessor.tsx file

## Example Files

- `src/components/VisionCamera.tsx` - The main camera component
- `src/components/ProductDetectionProcessor.tsx` - Frame processor for product detection
- `src/hooks/useVisionCamera.tsx` - Hook to manage camera state
- `src/examples/VisionCameraExample.tsx` - Example implementation

## Rebuilding Your App

After integrating VisionCamera, you'll need to:

1. Run the prebuild command if you haven't already:
   ```
   npx expo prebuild
   ```

2. For production, build a new binary with EAS:
   ```
   eas build
   ```

3. For development, you can run:
   ```
   npx expo start
   ```

## Additional Notes

- VisionCamera requires iOS 12 or higher, and Android SDK version 21 or higher
- The product detection is currently a simulation - in a real application, you would integrate a machine learning model
- To improve product detection, you could:
  - Integrate TensorFlow Lite
  - Use Firebase ML Kit
  - Implement a custom model trained on your product catalog 