'use strict';

const ModbusRTU = require('modbus-serial');
const { Sequelize } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { initModels } = require('./models');
const { createScaleWorker } = require('./workers/scaleWorker');
const { createSyncWorker } = require('./workers/syncWorker');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // --- Setup 2 DB terpisah (simulasi lokal & online) pakai sqlite in-memory ---
  const sequelizeLocalTest = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  const sequelizeOnlineTest = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });

  const localModels = initModels(sequelizeLocalTest, { includeSyncTracking: true });
  const onlineModels = initModels(sequelizeOnlineTest); // TANPA includeSyncTracking, meniru DB online asli

  await sequelizeLocalTest.sync({ force: true });
  await sequelizeOnlineTest.sync({ force: true });

  // Seed scale + scale_status di KEDUA db (meniru seed schema asli)
  const localScale = await localModels.Scale.create({ id: 1, code: 'TIMBANGAN-01', name: 'Timbangan 1' });
  await localModels.ScaleStatus.create({ scale_id: localScale.id, status: 'unknown' });

  await onlineModels.Scale.create({ id: 1, code: 'TIMBANGAN-01', name: 'Timbangan 1' });
  await onlineModels.ScaleStatus.create({ scale_id: 1, status: 'unknown' });

  // --- Server Modbus TCP tiruan ---
  const vector = { getInputRegister: () => 15075 }; // -> 150.75 kg
  const server = new ModbusRTU.ServerTCP(vector, { host: '127.0.0.1', port: 8502, unitID: 1 });
  console.log('=== Server Modbus TCP tiruan jalan di 127.0.0.1:8502 ===');

  const scaleConfig = {
    dbId: 1,
    code: 'TIMBANGAN-01',
    host: '127.0.0.1',
    tcpPort: 8502,
    unitId: 1,
    registerAddress: 0,
    registerLength: 1,
  };

  const scaleWorker = createScaleWorker({
    scaleConfig,
    models: localModels,
    pollIntervalMs: 200,
    modbusTimeoutMs: 500,
    generateSyncId: uuidv4,
  });

  // Flag simulasi status internet - dikontrol manual di test ini,
  // menggantikan testConnection() sungguhan supaya test deterministik.
  let onlineAvailable = true;

  const syncWorker = createSyncWorker({
    localModels,
    onlineModels,
    testOnlineConnection: async () => onlineAvailable,
    generateSyncId: uuidv4,
    syncIntervalMs: 300,
    batchSize: 100,
  });

  // --- FASE 1: online tersedia, semua harus sinkron normal ---
  scaleWorker.start();
  syncWorker.start();
  await wait(1200);

  let localPending = await localModels.ScaleReading.count({ where: { synced_at: null } });
  let onlineReadings = await onlineModels.ScaleReading.count();
  console.log('\n[FASE 1] Reading belum-sync di lokal (harus 0 atau mendekati 0):', localPending);
  console.log('[FASE 1] Jumlah reading di ONLINE:', onlineReadings, '(harus > 0)');

  let onlineStatus = await onlineModels.ScaleStatus.findOne({ where: { scale_id: 1 }, raw: true });
  console.log('[FASE 1] scale_status di ONLINE:', onlineStatus.status, '(harus connected)');

  let onlineLogs = await onlineModels.ScaleStatusLog.count();
  console.log('[FASE 1] Jumlah scale_status_logs di ONLINE:', onlineLogs, '(harus 1 - transisi unknown->connected)');

  // --- FASE 2: simulasi internet putus ---
  onlineAvailable = false;
  console.log('\n[FASE 2] Simulasi internet putus (testOnlineConnection -> false)...');
  await wait(1000); // scaleWorker tetap jalan, syncWorker harus skip semua siklus ini

  const onlineReadingsBeforeReconnect = await onlineModels.ScaleReading.count();
  localPending = await localModels.ScaleReading.count({ where: { synced_at: null } });
  console.log('[FASE 2] Reading ONLINE selama offline (harus TIDAK bertambah):', onlineReadingsBeforeReconnect);
  console.log('[FASE 2] Backlog belum-sync di LOKAL (harus bertambah, > 0):', localPending);

  // --- FASE 3: internet tersambung lagi, backlog harus otomatis terkirim ---
  onlineAvailable = true;
  console.log('\n[FASE 3] Internet tersambung lagi...');
  await wait(700);

  const onlineReadingsAfterReconnect = await onlineModels.ScaleReading.count();
  localPending = await localModels.ScaleReading.count({ where: { synced_at: null } });
  console.log(
    '[FASE 3] Reading ONLINE setelah reconnect (harus > sebelum offline):',
    onlineReadingsAfterReconnect,
    '>',
    onlineReadingsBeforeReconnect,
    '=',
    onlineReadingsAfterReconnect > onlineReadingsBeforeReconnect
  );
  console.log('[FASE 3] Backlog belum-sync di LOKAL sekarang (harus 0 atau mendekati 0):', localPending);

  const localReadingsTotal = await localModels.ScaleReading.count();
  const onlineReadingsTotal = await onlineModels.ScaleReading.count();
  console.log('[FASE 3] Total reading LOKAL vs ONLINE cocok:', localReadingsTotal, 'vs', onlineReadingsTotal);

  // --- FASE 4: test idempotensi - insert manual row "duplikat" di online
  // dengan sync_id yang SAMA seperti salah satu reading lokal yang BELUM
  // ditandai synced_at, lalu pastikan sync berikutnya tidak error dan
  // tidak menghasilkan baris dobel ---
  scaleWorker.stop();
  await wait(50);

  const fakeSyncId = uuidv4();
  await localModels.ScaleReading.create({
    sync_id: fakeSyncId,
    scale_id: 1,
    weight: 999.99,
    recorded_at: new Date(),
    synced_at: null, // sengaja belum ditandai sync, padahal online SUDAH punya sync_id ini
  });
  await onlineModels.ScaleReading.create({
    sync_id: fakeSyncId,
    scale_id: 1,
    weight: 999.99,
    recorded_at: new Date(),
  });

  const onlineCountBeforeDupTest = await onlineModels.ScaleReading.count({ where: { sync_id: fakeSyncId } });
  await wait(500); // biarkan minimal 1 siklus sync jalan

  const onlineCountAfterDupTest = await onlineModels.ScaleReading.count({ where: { sync_id: fakeSyncId } });
  const localRowAfterDupTest = await localModels.ScaleReading.findOne({ where: { sync_id: fakeSyncId }, raw: true });

  console.log('\n[FASE 4] Uji idempotensi (sync_id sudah ada duluan di online):');
  console.log('  - Jumlah baris online dgn sync_id itu SEBELUM sync ulang:', onlineCountBeforeDupTest, '(harus 1)');
  console.log('  - Jumlah baris online dgn sync_id itu SESUDAH sync ulang:', onlineCountAfterDupTest, '(harus TETAP 1, tidak dobel)');
  console.log('  - Baris lokal berhasil ditandai synced_at meski online-nya "duplikat":', !!localRowAfterDupTest.synced_at);

  syncWorker.stop();
  await new Promise((resolve) => server.close(resolve));
  await sequelizeLocalTest.close();
  await sequelizeOnlineTest.close();

  console.log('\n=== TEST SELESAI ===');
}

main().catch((err) => {
  console.error('TEST GAGAL:', err);
  process.exit(1);
});
