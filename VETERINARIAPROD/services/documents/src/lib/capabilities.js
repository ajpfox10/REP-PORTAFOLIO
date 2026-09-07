'use strict';

const EMAIL_PROVIDER_CAPABILITIES = Object.freeze([
  {
    key: 'gmail',
    label: 'Gmail API',
    authType: 'oauth2',
    syncMode: 'api',
    implemented: true,
    remoteSyncSupported: true,
    notes: 'Sincroniza adjuntos PDF con credenciales OAuth2 cargadas en settings.',
  },
  {
    key: 'imap',
    label: 'IMAP generico',
    authType: 'basic',
    syncMode: 'polling',
    implemented: true,
    remoteSyncSupported: true,
    notes: 'Sincroniza PDFs por IMAP con host, usuario y password/app password.',
  },
  {
    key: 'outlook',
    label: 'Microsoft 365 / Outlook',
    authType: 'oauth2',
    syncMode: 'api',
    implemented: false,
    remoteSyncSupported: false,
    notes: 'Pendiente de integrar via Microsoft Graph.',
  },
  {
    key: 'manual',
    label: 'Carga manual / importacion interna',
    authType: 'none',
    syncMode: 'manual',
    implemented: true,
    remoteSyncSupported: false,
    notes: 'Permite poblar la bandeja antes de tener conectores reales.',
  },
]);

const DOCUMENT_CATEGORY_CAPABILITIES = Object.freeze([
  {
    key: 'external_lab',
    label: 'Laboratorio externo',
    automaticIngestionImplemented: true,
    notes: 'Genera ordenes de laboratorio y items a partir del PDF asociado.',
  },
  {
    key: 'prescription',
    label: 'Receta',
    automaticIngestionImplemented: false,
    notes: 'Disponible solo para carga y asociacion manual por ahora.',
  },
  {
    key: 'medical_authorization',
    label: 'Autorizacion medica',
    automaticIngestionImplemented: false,
    notes: 'Disponible solo para carga y asociacion manual por ahora.',
  },
  {
    key: 'insurance_claim',
    label: 'Reclamo de seguro',
    automaticIngestionImplemented: false,
    notes: 'Disponible solo para carga y asociacion manual por ahora.',
  },
  {
    key: 'vet_clinic_records',
    label: 'Registros de otra clinica',
    automaticIngestionImplemented: false,
    notes: 'Disponible solo para carga y asociacion manual por ahora.',
  },
]);

function getProviderCapability(provider) {
  return EMAIL_PROVIDER_CAPABILITIES.find((entry) => entry.key === provider) || null;
}

function isProviderSyncSupported(provider) {
  return Boolean(getProviderCapability(provider)?.remoteSyncSupported);
}

function getDocumentCategoryCapability(category) {
  return DOCUMENT_CATEGORY_CAPABILITIES.find((entry) => entry.key === category) || null;
}

function isAutomaticIngestionSupported(category) {
  return Boolean(getDocumentCategoryCapability(category)?.automaticIngestionImplemented);
}

module.exports = {
  EMAIL_PROVIDER_CAPABILITIES,
  DOCUMENT_CATEGORY_CAPABILITIES,
  getProviderCapability,
  isProviderSyncSupported,
  getDocumentCategoryCapability,
  isAutomaticIngestionSupported,
};
