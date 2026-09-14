'use strict';

const DEFAULT_BATCH_SIZE = 100;

/**
 * Bikin sync worker yang mendorong data dari DB LOKAL ke DB ONLINE
 * secara berkala. Berbeda dari scaleWorker (1 worker per timbangan),
 * sync worker ini 1 instance saja untuk semua timbangan sekaligus,
 * karena tugasnya bukan baca alat, tapi mindahin data yang menumpuk
 * di lokal.
 *
 * Deteksi status internet: dicek langsung dari gagal/berhasilnya
 * `testOnlineConnection()` di setiap siklus (bukan ping terpisah).
 * Kalau gagal, siklus itu dilewati - data tetap aman di lokal dan
 * akan otomatis coba lagi di siklus berikutnya. Begitu online lagi,
 * seluruh backlog (WHERE synced_at IS NULL) otomatis terkirim,
 * bertahap sesuai SYNC_BATCH_SIZE per siklus.
 *
 * @param {object} params
 * @param {object} params.localModels - hasil initModels(sequelizeLocal, { includeSyncTracking: true })
 * @param {object} params.onlineModels - hasil initModels(sequelizeOnline)
 * @param {() => Promise<boolean>} params.testOnlineConnection - fungsi cek koneksi DB online
 * @param {() => string} params.generateSyncId - generator UUID (dipakai untuk scale_status_logs)
 * @param {number} params.syncIntervalMs
 * @param {number} [params.batchSize]
 */
function createSyncWorker({
  localModels,
  onlineModels,
  testOnlineConnection,
  syncIntervalMs,
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  let running = false;
  let timer = null;
  let syncing = false; // guard - cegah tumpang tindih kalau 1 siklus lama

  /**
   * Sinkron tabel append-only (scale_readings / scale_status_logs) yang
   * punya kolom sync_id (unik lintas DB) + synced_at (lokal saja).
   * Pola sama untuk keduanya: ambil yang synced_at IS NULL, bulkCreate
   * ke online dengan ignoreDuplicates (aman kalau sync_id sudah ada di
   * online dari percobaan sebelumnya yang terputus di tengah jalan),
   * lalu tandai synced_at di lokal.
   */
  async function syncAppendOnlyTable(localModel, onlineModel, mapRow, label) {
    const pending = await localModel.findAll({
      where: { synced_at: null },
      order: [['id', 'ASC']],
      limit: batchSize,
      raw: true,
    });

    if (pending.length === 0) return 0;

    const rows = pending.map(mapRow);

    // ignoreDuplicates -> INSERT IGNORE di MySQL: baris yang sync_id-nya
    // sudah ada di online akan di-skip diam-diam, bukan error.
    await onlineModel.bulkCreate(rows, { ignoreDuplicates: true });

    const ids = pending.map((row) => row.id);
    await localModel.update({ synced_at: new Date() }, { where: { id: ids } });

    console.log(`[SyncWorker] ${label}: ${pending.length} baris disinkron.`);
    return pending.length;
  }

  async function syncScaleReadings() {
    return syncAppendOnlyTable(
      localModels.ScaleReading,
      onlineModels.ScaleReading,
      (row) => ({
        sync_id: row.sync_id,
        scale_id: row.scale_id,
        weight: row.weight,
        recorded_at: row.recorded_at,
        created_at: row.created_at,
      }),
      'scale_readings'
    );
  }

  async function syncScaleStatusLogs() {
    return syncAppendOnlyTable(
      localModels.ScaleStatusLog,
      onlineModels.ScaleStatusLog,
      (row) => ({
        sync_id: row.sync_id,
        scale_id: row.scale_id,
        status: row.status,
        message: row.message,
        occurred_at: row.occurred_at,
      }),
      'scale_status_logs'
    );
  }

  /**
   * scale_status BEDA dari 2 tabel di atas: cuma beberapa baris (1 per
   * timbangan) dan di-UPDATE terus, bukan nambah baris baru. Jadi bukan
   * batch-insert, tapi overwrite baris online kalau versi lokal lebih
   * baru (updated_at > synced_at).
   */
  async function syncScaleStatus() {
    const localRows = await localModels.ScaleStatus.findAll({ raw: true });
    let pushed = 0;

    for (const row of localRows) {
      const needsSync = !row.synced_at || new Date(row.updated_at) > new Date(row.synced_at);
      if (!needsSync) continue;

      await onlineModels.ScaleStatus.update(
        {
          status: row.status,
          last_connected_at: row.last_connected_at,
          last_error_message: row.last_error_message,
        },
        { where: { scale_id: row.scale_id } }
      );

      await localModels.ScaleStatus.update(
        { synced_at: new Date() },
        { where: { scale_id: row.scale_id } }
      );

      pushed += 1;
    }

    if (pushed > 0) {
      console.log(`[SyncWorker] scale_status: ${pushed} baris disinkron.`);
    }

    return pushed;
  }

  async function syncOnce() {
    if (syncing) {
      console.log('[SyncWorker] Siklus sebelumnya masih berjalan, lewati tick ini.');
      return;
    }
    syncing = true;

    try {
      const online = await testOnlineConnection();
      if (!online) {
        console.log('[SyncWorker] DB online tidak terjangkau (kemungkinan internet putus) - lewati siklus ini.');
        return;
      }

      await syncScaleReadings();
      await syncScaleStatusLogs();
      await syncScaleStatus();
    } catch (err) {
      console.error(`[SyncWorker] Gagal sinkron: ${err.message}`);
    } finally {
      syncing = false;
    }
  }

  function scheduleNext() {
    if (!running) return;
    timer = setTimeout(async () => {
      await syncOnce();
      scheduleNext();
    }, syncIntervalMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      console.log(`[SyncWorker] Dimulai (interval ${syncIntervalMs}ms, batch size ${batchSize})`);
      syncOnce().then(scheduleNext);
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      console.log('[SyncWorker] Dihentikan');
    },
  };
}

module.exports = { createSyncWorker };
