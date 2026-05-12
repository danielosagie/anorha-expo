import React from 'react'
import { Text, TextInput, StyleSheet } from 'react-native'


function TextField (type: string, text: string, placeholder: string) {

    //set type
    const [type, setType] = String["single" || "multi"]
    //set text

    
    return (
        <TextInput
          style={styles.formInputMultiline}
          value={String(currentPlatformData.description || '')}
          onChangeText={(text: string) => handleFormUpdate(currentPlatformKey!, 'description', text)}
          multiline
          numberOfLines={4}
          placeholder="Enter product description"
        />
    )
}

export default TextField

const styles = StyleSheet.create({
  singleLine: {


  }, 
  multiLine: {

  }


})