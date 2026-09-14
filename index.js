'use strict';

const { v4: uuidv4 } = require('uuid');
const { loadScalesConfig } = require('./config/scales');
const { sequelizeLocal, sequelizeOnline, testConnection, closeConnections } = require('./config/connections');
const { initModels } = require('./models');
const { createScaleWorker } = require('./workers/scaleWorker');
const { createSyncWorker } = require('./workers/syncWorker');

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);
const MODBUS_TIMEOUT_MS = Number(process.env.MODBUS_TIMEOUT_MS || 1000);
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 5000);
const SYNC_BATCH_SIZE = Number(process.env.SYNC_BATCH_SIZE || 100);

async function main() {
  const scales = loadScalesConfig();
  console.log(`Ditemukan ${scales.length} konfigurasi timbangan di .env`);

  const localOk = await testConnection(sequelizeLocal, 'local');
  if (!localOk) {
    throw new Error('Tidak bisa konek ke database lokal, worker tidak dijalankan.');
  }
  // Catatan: tidak wajib online saat start - kalau memang lagi offline,
  // scale worker tetap jalan nulis ke lokal, sync worker akan otomatis
  // nyusul begitu koneksi online tersedia (dicek tiap siklusnya sendiri).
  await testConnection(sequelizeOnline, 'online');

  // includeSyncTracking: true HANYA untuk local - lihat models/index.js
  const localModels = initModels(sequelizeLocal, { includeSyncTracking: true });
  const onlineModels = initModels(sequelizeOnline);

  const scaleWorkers = scales.map((scaleConfig) =>
    createScaleWorker({
      scaleConfig,
      models: localModels,
      pollIntervalMs: POLL_INTERVAL_MS,
      modbusTimeoutMs: MODBUS_TIMEOUT_MS,
      generateSyncId: uuidv4,
    })
  );

  const syncWorker = createSyncWorker({
    localModels,
    onlineModels,
    testOnlineConnection: () => testConnection(sequelizeOnline, 'online'),
    generateSyncId: uuidv4,
    syncIntervalMs: SYNC_INTERVAL_MS,
    batchSize: SYNC_BATCH_SIZE,
  });

  scaleWorkers.forEach((worker) => worker.start());
  syncWorker.start();

  async function shutdown(signal) {
    console.log(`\nMenerima ${signal}, menghentikan semua worker...`);
    await Promise.all(scaleWorkers.map((worker) => worker.stop()));
    syncWorker.stop();
    await closeConnections();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Gagal menjalankan worker:', err.message);
  process.exit(1);
});
