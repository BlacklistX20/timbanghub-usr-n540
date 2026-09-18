'use strict';

/**
 * Script diagnostik untuk cek apakah data BENAR-BENAR bisa disimpan ke
 * database LOKAL dan ONLINE sesuai .env - pakai koneksi & model asli
 * (config/connections.js, models/index.js), BUKAN database tiruan.
 *
 * Yang dites (mirip pola tulis yang dipakai scaleWorker & syncWorker):
 *   1. Insert 1 baris dummy ke ScaleReading
 *   2. Update ScaleStatus
 *   3. Insert 1 baris dummy ke ScaleStatusLog
 *   4. Baca ulang untuk konfirmasi tersimpan
 *   5. Hapus lagi data dummy-nya (cleanup - tidak numpuk di DB asli)
 *
 * Dites terpisah untuk lokal & online - kalau salah satu gagal/offline,
 * yang lain tetap dites & dilaporkan.
 *
 * Jalankan: node test-database-storage.js
 */

const { v4: uuidv4 } = require('uuid');
const { loadScalesConfig } = require('./config/scales');
const { sequelizeLocal, sequelizeOnline, testConnection, closeConnections } = require('./config/connections');
const { initModels } = require('./models');

async function testStorage(label, models, scaleDbId) {
  console.log(`\n--- Tes simpan data dummy ke DB ${label} (scale_id=${scaleDbId}) ---`);

  // 1. Insert dummy reading (weight=0 sengaja dipakai supaya gampang
  // dikenali sebagai data dummy, bukan data timbangan asli)
  const syncId = uuidv4();
  const reading = await models.ScaleReading.create({
    sync_id: syncId,
    scale_id: scaleDbId,
    weight: 0,
    recorded_at: new Date(),
  });
  console.log(`[${label}] ScaleReading tersimpan -> id=${reading.id}, sync_id=${syncId}`);

  // 2. Update status
  const [affected] = await models.ScaleStatus.update(
    { status: 'connected', last_connected_at: new Date() },
    { where: { scale_id: scaleDbId } }
  );
  if (affected === 0) {
    console.warn(
      `[${label}] PERINGATAN: tidak ada baris scale_status utk scale_id=${scaleDbId} - pastikan seed data (scales + scale_status) sudah di-import.`
    );
  } else {
    console.log(`[${label}] ScaleStatus berhasil di-update (status=connected)`);
  }

  // 3. Insert dummy status log
  const logSyncId = uuidv4();
  const log = await models.ScaleStatusLog.create({
    sync_id: logSyncId,
    scale_id: scaleDbId,
    status: 'connected',
    message: 'Dummy test dari test-database-storage.js - aman diabaikan',
  });
  console.log(`[${label}] ScaleStatusLog tersimpan -> id=${log.id}, sync_id=${logSyncId}`);

  // 4. Baca ulang untuk konfirmasi
  const readBack = await models.ScaleReading.findByPk(reading.id);
  console.log(`[${label}] Baca ulang ScaleReading OK -> weight=${readBack.weight}`);

  // 5. Bersihkan data dummy supaya tidak numpuk di database asli
  await models.ScaleReading.destroy({ where: { id: reading.id } });
  await models.ScaleStatusLog.destroy({ where: { id: log.id } });
  console.log(`[${label}] Data dummy sudah dihapus lagi (cleanup selesai)`);

  return true;
}

async function main() {
  const scales = loadScalesConfig();
  const testScaleId = scales[0].dbId; // pakai timbangan pertama sesuai .env

  console.log('=== Tes Koneksi & Penyimpanan Data Dummy (DB Lokal & Online) ===');

  const localOk = await testConnection(sequelizeLocal, 'local');
  const onlineOk = await testConnection(sequelizeOnline, 'online');

  console.log(`\nKoneksi DB lokal : ${localOk ? 'OK' : 'GAGAL'}`);
  console.log(`Koneksi DB online: ${onlineOk ? 'OK' : 'GAGAL (cek internet/kredensial kalau memang harusnya online)'}`);

  if (localOk) {
    // includeSyncTracking: true - sama seperti dipakai index.js utk lokal
    const localModels = initModels(sequelizeLocal, { includeSyncTracking: true });
    try {
      await testStorage('LOKAL', localModels, testScaleId);
    } catch (err) {
      console.error(`[LOKAL] Tes penyimpanan GAGAL: ${err.message}`);
    }
  } else {
    console.log('\nDilewati: tes simpan ke LOKAL (koneksi gagal, cek dulu koneksinya)');
  }

  if (onlineOk) {
    const onlineModels = initModels(sequelizeOnline);
    try {
      await testStorage('ONLINE', onlineModels, testScaleId);
    } catch (err) {
      console.error(`[ONLINE] Tes penyimpanan GAGAL: ${err.message}`);
    }
  } else {
    console.log('\nDilewati: tes simpan ke ONLINE (koneksi gagal - ini NORMAL kalau memang lagi tanpa internet)');
  }

  await closeConnections();
  console.log('\n=== TES SELESAI ===');
}

main().catch((err) => {
  console.error('Tes gagal dijalankan:', err.message);
  process.exit(1);
});
