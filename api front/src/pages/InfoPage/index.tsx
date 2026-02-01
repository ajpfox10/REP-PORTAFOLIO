// src/pages/InfoPage/index.tsx
import React from 'react';
import { Layout } from '../../components/Layout';
import { InfoContent } from './components/InfoContent';

// Si existe CSS, importarlo
import './styles/InfoPage.css';

export function InfoPage() {
  return (
    <Layout title="Información" showBack>
      <InfoContent />
    </Layout>
  );
}