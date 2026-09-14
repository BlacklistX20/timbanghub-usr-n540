'use strict';

/**
 * Script diagnostik untuk cek koneksi ke USR-N540 (4 timbangan) SUNGGUHAN.
 * TIDAK ada Modbus TCP server tiruan, TIDAK ada database - murni konek ke
 * alat asli sesuai config di .env, baca register, tampilkan di console
 * tiap POLL_INTERVAL_MS. Berhenti dengan Ctrl+C.
 *
 * Jalankan: node test-hardware-connection.js
 */

const ModbusRTU = require('modbus-serial');
const { loadScalesConfig } = require('./config/scales');

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);
const WEIGHT_DIVISOR = 100;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * State per timbangan: client Modbus + hasil pembacaan terakhir untuk
 * ditampilkan di tabel.
 */
function createScaleState(scaleConfig) {
  return {
    config: scaleConfig,
    client: new ModbusRTU(),
    isConnected: false,
    status: 'belum konek',
    rawValue: null,
    weight: null,
    lastError: null,
    lastUpdatedAt: null,
  };
}

function combineRegisters(scaleConfig, data) {
  if (scaleConfig.registerLength === 1) {
    return data[0];
  }
  if (scaleConfig.registerLength === 2) {
    // ASUMSI big-endian - lihat catatan yang sama di workers/scaleWorker.js
    return (data[0] << 16) | data[1];
  }
  throw new Error(`registerLength ${scaleConfig.registerLength} belum didukung`);
}

async function pollScale(state) {
  const { config, client } = state;

  try {
    if (!state.isConnected) {
      await client.connectTCP(config.host, { port: config.tcpPort });
      client.setID(config.unitId);
      client.setTimeout(1000);
      state.isConnected = true;
    }

    const result = await client.readInputRegisters(config.registerAddress, config.registerLength);
    const rawValue = combineRegisters(config, result.data);

    state.rawValue = rawValue;
    state.weight = rawValue / WEIGHT_DIVISOR;
    state.status = 'OK';
    state.lastError = null;
    state.lastUpdatedAt = new Date();
  } catch (err) {
    state.status = 'GAGAL';
    state.lastError = err.message;
    state.weight = null;
    state.rawValue = null;
    state.isConnected = false;
    try {
      if (client.isOpen) client.close(() => {});
    } catch (_e) {
      // abaikan
    }
  }
}

function printTable(states) {
  console.clear();
  console.log(`=== Tes Koneksi USR-N540 - ${new Date().toLocaleString('id-ID')} ===`);
  console.log(`(Ctrl+C untuk berhenti, refresh tiap ${POLL_INTERVAL_MS}ms)\n`);

  const rows = states.map((s) => ({
    Kode: s.config.code,
    Target: `${s.config.host}:${s.config.tcpPort}`,
    UnitID: s.config.unitId,
    Status: s.status,
    'Raw Value': s.rawValue ?? '-',
    'Berat (kg)': s.weight ?? '-',
    'Terakhir Update': s.lastUpdatedAt ? s.lastUpdatedAt.toLocaleTimeString('id-ID') : '-',
    Error: s.lastError ?? '-',
  }));

  console.table(rows);
}

async function main() {
  const scales = loadScalesConfig();
  console.log(`Ditemukan ${scales.length} konfigurasi timbangan di .env, mulai tes koneksi...\n`);

  const states = scales.map(createScaleState);
  let running = true;

  process.on('SIGINT', async () => {
    running = false;
    console.log('\n\nMenghentikan tes, menutup semua koneksi...');
    await Promise.all(
      states.map(async (s) => {
        try {
          if (s.client.isOpen) s.client.close(() => {});
        } catch (_e) {
          // abaikan
        }
      })
    );
    process.exit(0);
  });

  while (running) {
    await Promise.all(states.map(pollScale));
    printTable(states);
    await wait(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('Tes gagal dijalankan:', err.message);
  process.exit(1);
});
