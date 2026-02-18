import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View } from 'react-native';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import DocumentsScreen from './src/screens/DocumentsScreen';
import DocumentViewerScreen from './src/screens/DocumentViewerScreen';
import EventosScreen from './src/screens/EventosScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import api from './src/services/api';

const Stack = createStackNavigator();

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState(null);

  useEffect(() => {
    checkToken();
  }, []);

  const checkToken = async () => {
    try {
      const token = await AsyncStorage.getItem('@auth:token');
      if (token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        setUserToken(token);
      }
    } catch (e) {
      console.log('Error loading token', e);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        {userToken ? (
          <>
            <Stack.Screen 
              name="Home" 
              component={HomeScreen} 
              options={{ title: 'PersonalV5', headerShown: false }}
            />
            <Stack.Screen 
              name="Documents" 
              component={DocumentsScreen} 
              options={{ title: 'Documentos' }}
            />
            <Stack.Screen 
              name="DocumentViewer" 
              component={DocumentViewerScreen} 
              options={{ title: 'Visor' }}
            />
            <Stack.Screen 
              name="Eventos" 
              component={EventosScreen} 
              options={{ title: 'Eventos' }}
            />
            <Stack.Screen 
              name="Profile" 
              component={ProfileScreen} 
              options={{ title: 'Perfil' }}
            />
          </>
        ) : (
          <Stack.Screen 
            name="Login" 
            component={LoginScreen} 
            options={{ headerShown: false }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}