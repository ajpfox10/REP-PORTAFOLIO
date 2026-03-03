import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Linking,
  TouchableOpacity,
  Share,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { getDocumentFile } from '../services/api';

export default function DocumentViewerScreen({ route, navigation }) {
  const { document } = route.params;
  const fileUrl = getDocumentFile(document.id);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Documento: ${document.nombre}\n${fileUrl}`,
        title: document.nombre,
      });
    } catch (error) {
      console.log('Error sharing', error);
    }
  };

  const handleDownload = () => {
    Linking.openURL(fileUrl);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {document.nombre || 'Documento'}
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity onPress={handleShare} style={styles.actionButton}>
            <Text style={styles.actionText}>↗️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDownload} style={styles.actionButton}>
            <Text style={styles.actionText}>⬇️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <WebView
        source={{ uri: fileUrl }}
        style={styles.webview}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>Cargando documento...</Text>
          </View>
        )}
        renderError={() => (
          <View style={styles.error}>
            <Text style={styles.errorText}>Error al cargar el documento</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => {}}>
              <Text style={styles.retryText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
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
    padding: 15,
    backgroundColor: 'rgba(124,58,237,0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: 8,
    marginLeft: 10,
  },
  actionText: {
    fontSize: 20,
  },
  webview: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0b1020',
  },
  loadingText: {
    color: '#999',
    fontSize: 14,
  },
  error: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0b1020',
    padding: 20,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
  },
});