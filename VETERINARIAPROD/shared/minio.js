'use strict';

const { Client } = require('minio');
const path       = require('path');
const crypto     = require('crypto');
const { getAnySecret, getSecret } = require('./secrets');

let minioClient;

function getClient() {
  if (!minioClient) {
    const accessKey = getAnySecret(['MINIO_USER', 'MINIO_ACCESS_KEY']);
    const secretKey = getAnySecret(['MINIO_PASSWORD', 'MINIO_SECRET_KEY']);
    if (!accessKey || !secretKey) {
      throw new Error('MinIO credentials must be configured');
    }
    minioClient = new Client({
      endPoint:  process.env.MINIO_ENDPOINT || 'minio',
      port:      parseInt(process.env.MINIO_PORT || '9000'),
      useSSL:    process.env.MINIO_USE_SSL === 'true',
      accessKey,
      secretKey,
    });
  }
  return minioClient;
}

const BUCKETS = {
  patients: process.env.MINIO_BUCKET_PATIENTS || 'patient-files',
  grooming: process.env.MINIO_BUCKET_GROOMING || 'grooming-photos',
  tele:     process.env.MINIO_BUCKET_TELE     || 'tele-docs',
  documents: process.env.MINIO_BUCKET_DOCUMENTS || 'documents-inbox',
};

/**
 * Ensure bucket exists (create if missing).
 */
async function ensureBucket(bucketName) {
  const client = getClient();
  const exists = await client.bucketExists(bucketName);
  if (!exists) {
    await client.makeBucket(bucketName, 'us-east-1');
    // No public policy — all access via presigned URLs only
  }
}

/**
 * Upload a file buffer to MinIO.
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string} bucket
 * @param {string} folder   e.g. 'patients/123'
 * @returns {Promise<string>} object name (use getPresignedUrl to serve it)
 */
async function uploadFile(buffer, originalName, bucket = BUCKETS.patients, folder = '') {
  await ensureBucket(bucket);

  // SEC: normalizar extensión y sanitizar el folder para prevenir path traversal
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  // Sanitizar folder: solo alfanumérico, guiones, barras simples
  const safeFolder = (folder || '').replace(/[^a-zA-Z0-9/_-]/g, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  const name     = `${safeFolder ? safeFolder + '/' : ''}${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const mimeType = getMimeType(ext);

  await getClient().putObject(bucket, name, buffer, buffer.length, {
    'Content-Type': mimeType,
  });

  // SEC: no exponer la URL interna de MinIO directamente. Devolver solo el nombre
  // del objeto; el caller debe llamar getPresignedUrl() para servir el archivo.
  // Si se necesita una URL pública configurable, usar MINIO_PUBLIC_URL.
  const publicBase = process.env.MINIO_PUBLIC_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${bucket}/${name}`;
  }
  // Fallback: URL interna (solo útil en desarrollo donde MinIO es directamente accesible)
  const endpoint = process.env.MINIO_ENDPOINT || 'minio';
  const port     = process.env.MINIO_PORT || '9000';
  const proto    = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  return `${proto}://${endpoint}:${port}/${bucket}/${name}`;
}

// SEC: TTL máximo para presigned URLs — evitar URLs de larga duración que no puedan revocarse
const MAX_PRESIGNED_URL_EXPIRY_SECS = parseInt(process.env.MINIO_MAX_PRESIGNED_TTL_SECS || '3600', 10);

/**
 * Valida el nombre de un objeto para prevenir bucket traversal / path injection.
 */
function validateObjectName(objectName) {
  if (!objectName || typeof objectName !== 'string') {
    throw Object.assign(new Error('Invalid object name'), { code: 'INVALID_OBJECT_NAME' });
  }
  // Rechazar rutas que escapen del directorio: .., comenzar con /, barras dobles, nulos
  if (
    objectName.includes('..') ||
    objectName.startsWith('/') ||
    objectName.includes('\0') ||
    objectName.includes('//') ||
    /[\x00-\x1f]/.test(objectName)   // caracteres de control
  ) {
    throw Object.assign(new Error('Invalid object name'), { code: 'INVALID_OBJECT_NAME' });
  }
}

/**
 * Generate a presigned URL for temporary access.
 */
async function getPresignedUrl(bucket, objectName, expirySeconds = 3600) {
  validateObjectName(objectName);
  // SEC: limitar TTL para que las URLs no sean permanentemente válidas
  const safeTtl = Math.min(expirySeconds, MAX_PRESIGNED_URL_EXPIRY_SECS);
  return getClient().presignedGetObject(bucket, objectName, safeTtl);
}

/**
 * Delete a file from MinIO.
 */
async function deleteFile(bucket, objectName) {
  return getClient().removeObject(bucket, objectName);
}

async function getObjectBuffer(bucket, objectName) {
  const stream = await getClient().getObject(bucket, objectName);
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function getMimeType(ext) {
  const types = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.dcm': 'application/dicom',
  };
  return types[ext] || 'application/octet-stream';
}

module.exports = { getClient, uploadFile, getPresignedUrl, deleteFile, getObjectBuffer, BUCKETS, validateObjectName };
