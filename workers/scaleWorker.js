'use strict';

const ModbusRTU = require('modbus-serial');

const DEFAULT_MODBUS_TIMEOUT_MS = 1000;

/**
 * Bikin satu worker independen untuk 1 timbangan (1 koneksi Modbus TCP
 * ke 1 port di USR-N540). Beberapa worker dijalankan bersamaan dalam 1
 * proses Node lewat loop asinkron masing-masing - bukan worker_threads
 * atau child_process - karena baca Modbus TCP & tulis DB itu I/O-bound,
 * jadi 1 timbangan yang lambat/error tidak mem-block baca timbangan lain.
 *
 * PENTING: worker ini HANYA menulis ke database LOKAL. Sinkronisasi ke
 * database online adalah tanggung jawab modul terpisah (sync worker),
 * belum dibuat di sini.
 *
 * @param {object} params
 * @param {object} params.scaleConfig - satu item hasil config/scales.js loadScalesConfig()
 * @param {object} params.models - models LOKAL: { ScaleReading, ScaleStatus, ScaleStatusLog }
 *                                  (hasil initModels(sequelizeLocal))
 * @param {number} params.pollIntervalMs - jeda antar pembacaan, dalam ms
 * @param {() => string} params.generateSyncId - generator UUID (pakai package `uuid`,
 *                                  mis. () => uuidv4()). WAJIB unik per baris reading.
 * @param {number} [params.modbusTimeoutMs] - timeout baca Modbus, default 1000ms.
 *                                  Sebaiknya lebih kecil dari pollIntervalMs supaya
 *                                  tidak menumpuk antar tick.
 * @param {number} [params.minWeightKg] - batas bawah berat valid (kg). Pembacaan
 *                                  di bawah ini TIDAK disimpan ke scale_readings,
 *                                  tapi status tetap 'connected' (bukan error koneksi).
 *                                  Default -Infinity (tidak ada batas bawah).
 * @param {number} [params.maxWeightKg] - batas atas berat valid (kg), sama
 *                                  perlakuannya dengan minWeightKg.
 *                                  Default Infinity (tidak ada batas atas).
 */
function createScaleWorker({
  scaleConfig,
  models,
  pollIntervalMs,
  generateSyncId,
  modbusTimeoutMs = DEFAULT_MODBUS_TIMEOUT_MS,
  minWeightKg = -Infinity,
  maxWeightKg = Infinity,
}) {
  const { ScaleReading, ScaleStatus, ScaleStatusLog } = models;
  const client = new ModbusRTU();

  let running = false;
  let timer = null;
  let isConnected = false;
  let lastKnownStatus = null; // untuk deteksi transisi status (hindari log banjir)

  const logPrefix = `[Worker:${scaleConfig.code}]`;

  async function connect() {
    await client.connectTCP(scaleConfig.host, { port: scaleConfig.tcpPort });
    client.setID(scaleConfig.unitId);
    client.setTimeout(modbusTimeoutMs);
    isConnected = true;
  }

  function disconnect() {
    try {
      if (client.isOpen) {
        client.close(() => {});
      }
    } catch (_err) {
      // abaikan error saat close, koneksi memang mau ditutup
    }
    isConnected = false;
  }

  /**
   * Update scale_status (kondisi TERKINI, 1 baris per timbangan - di-UPDATE).
   * Hanya tulis ke scale_status_logs (audit trail) kalau status BERUBAH
   * dari tick sebelumnya, supaya tabel log tidak banjir tiap detik.
   */
  async function reportStatus(status, errorMessage) {
    const now = new Date();

    await ScaleStatus.update(
      {
        status,
        last_error_message: errorMessage || null,
        ...(status === 'connected' ? { last_connected_at: now } : {}),
      },
      { where: { scale_id: scaleConfig.dbId } }
    );

    if (status !== lastKnownStatus) {
      await ScaleStatusLog.create({
        sync_id: generateSyncId(),
        scale_id: scaleConfig.dbId,
        status,
        message: errorMessage || null,
        occurred_at: now,
      });
      lastKnownStatus = status;
    }
  }

  function combineRegisters(data) {
    if (scaleConfig.registerLength === 1) {
      return data[0];
    }

    if (scaleConfig.registerLength === 2) {
      // ASUMSI: big-endian, register pertama = high word, kedua = low word.
      // BELUM diverifikasi ke alat sungguhan - kalau nilai berat yang
      // terbaca aneh/tidak masuk akal, kemungkinan urutannya perlu
      // dibalik. Sesuaikan dengan dokumen protokol indikator timbangan.
      return (data[0] << 16) | data[1];
    }

    throw new Error(`registerLength ${scaleConfig.registerLength} belum didukung`);
  }

  async function pollOnce() {
    try {
      if (!isConnected) {
        await connect();
      }

      const result = await client.readInputRegisters(
        scaleConfig.registerAddress,
        scaleConfig.registerLength
      );

      const rawValue = combineRegisters(result.data);
      const weight = rawValue / 100;

      const withinValidRange = weight >= minWeightKg && weight <= maxWeightKg;

      if (withinValidRange) {
        await ScaleReading.create({
          sync_id: generateSyncId(),
          scale_id: scaleConfig.dbId,
          weight,
          recorded_at: new Date(),
        });
      }
      // Di luar rentang minWeightKg..maxWeightKg -> sengaja TIDAK disimpan
      // ke scale_readings (dianggap anomali/noise), dan sengaja TIDAK
      // di-log ke console (sesuai keputusan). Koneksi ke alat sendiri
      // berhasil, jadi status tetap dilaporkan 'connected' di bawah ini.

      await reportStatus('connected', null);
    } catch (err) {
      console.error(`${logPrefix} Gagal baca/simpan: ${err.message}`);
      disconnect();

      try {
        await reportStatus('error', err.message);
      } catch (statusErr) {
        console.error(`${logPrefix} Gagal update status: ${statusErr.message}`);
      }
    }
  }

  function scheduleNext() {
    if (!running) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, pollIntervalMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      console.log(
        `${logPrefix} Worker dimulai (poll tiap ${pollIntervalMs}ms, target ${scaleConfig.host}:${scaleConfig.tcpPort}, unitId=${scaleConfig.unitId})`
      );
      // Tick pertama jalan segera, baru dijadwalkan berikutnya via setTimeout
      // (bukan setInterval) supaya tidak overlap kalau 1 tick lebih lambat
      // dari pollIntervalMs.
      pollOnce().then(scheduleNext);
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      disconnect();
      console.log(`${logPrefix} Worker dihentikan`);
    },
  };
}

module.exports = { createScaleWorker };