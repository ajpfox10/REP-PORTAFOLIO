import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logout } from '../services/api';

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const userStr = await AsyncStorage.getItem('@auth:user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Cerrar sesión',
      '¿Estás seguro?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: async () => {
            await logout();
            navigation.replace('Login');
          },
        },
      ]
    );
  };

  const MenuButton = ({ title, icon, onPress, color }) => (
    <TouchableOpacity style={[styles.menuButton, { borderColor: color }]} onPress={onPress}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={styles.menuTitle}>{title}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.welcome}>Bienvenido,</Text>
          <Text style={styles.userName}>{user?.email || 'Usuario'}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        <MenuButton
          title="Documentos"
          icon="📄"
          color="#7c3aed"
          onPress={() => navigation.navigate('Documents')}
        />
        <MenuButton
          title="Eventos"
          icon="📅"
          color="#22d3ee"
          onPress={() => navigation.navigate('Eventos')}
        />
        <MenuButton
          title="Perfil"
          icon="👤"
          color="#10b981"
          onPress={() => navigation.navigate('Profile')}
        />
        <MenuButton
          title="Buscar"
          icon="🔍"
          color="#f59e0b"
          onPress={() => Alert.alert('Próximamente', 'Búsqueda de personal')}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(124,58,237,0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  welcome: {
    color: '#999',
    fontSize: 14,
  },
  userName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
    justifyContent: 'space-between',
  },
  menuButton: {
    width: '48%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#7c3aed',
    alignItems: 'center',
  },
  menuIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  menuTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});