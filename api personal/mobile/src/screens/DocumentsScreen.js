import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { getDocuments } from '../services/api';

export default function DocumentsScreen({ navigation }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const loadDocuments = async (pageNum = 1, refresh = false) => {
    try {
      const response = await getDocuments(pageNum, 20);
      const newDocs = response.data || [];
      
      if (refresh) {
        setDocuments(newDocs);
      } else {
        setDocuments(prev => [...prev, ...newDocs]);
      }
      
      setHasMore(newDocs.length === 20);
    } catch (error) {
      console.error('Error loading documents', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    setPage(1);
    loadDocuments(1, true);
  };

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadDocuments(nextPage);
    }
  };

  const renderDocument = ({ item }) => (
    <TouchableOpacity
      style={styles.documentCard}
      onPress={() => navigation.navigate('DocumentViewer', { document: item })}
    >
      <Text style={styles.documentIcon}>📄</Text>
      <View style={styles.documentInfo}>
        <Text style={styles.documentName}>{item.nombre || 'Sin nombre'}</Text>
        <Text style={styles.documentMeta}>
          {item.tipo || 'Documento'} · {item.fecha || 'Sin fecha'}
        </Text>
        <Text style={styles.documentDesc} numberOfLines={2}>
          {item.descripcion || 'Sin descripción'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={documents}
        renderItem={renderDocument}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          hasMore ? (
            <ActivityIndicator style={styles.loader} color="#7c3aed" />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0b1020',
  },
  list: {
    padding: 15,
  },
  documentCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  documentIcon: {
    fontSize: 40,
    marginRight: 15,
  },
  documentInfo: {
    flex: 1,
  },
  documentName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  documentMeta: {
    color: '#7c3aed',
    fontSize: 12,
    marginBottom: 4,
  },
  documentDesc: {
    color: '#999',
    fontSize: 13,
  },
  loader: {
    marginVertical: 20,
  },
});