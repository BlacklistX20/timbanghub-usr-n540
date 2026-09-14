'use strict';

const ModbusRTU = require('modbus-serial');
const { v4: uuidv4 } = require('uuid');
const { createScaleWorker } = require('./workers/scaleWorker');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------
// Model palsu - TIDAK ada DB sungguhan di belakangnya, cuma
// console.log tiap kali worker mau "menulis". Cukup untuk
// mengecek logika baca Modbus, reconnect, dan status tanpa
// perlu setup database (sqlite/MySQL) sama sekali.
// ---------------------------------------------------------
const mockModels = {
  ScaleReading: {
    create: async (data) => {
      console.log(
        `[ScaleReading.create] scale_id=${data.scale_id} weight=${data.weight} sync_id=${data.sync_id}`
      );
      return data;
    },
  },
  ScaleStatus: {
    update: async (data, options) => {
      console.log(`[ScaleStatus.update] scale_id=${options.where.scale_id} ->`, data);
    },
  },
  ScaleStatusLog: {
    create: async (data) => {
      console.log(
        `[ScaleStatusLog.create] scale_id=${data.scale_id} status=${data.status} message=${data.message || '-'}`
      );
      return data;
    },
  },
};

async function main() {
  // register 0 = raw value (weight * 100), diubah di tengah test untuk
  // simulasi perubahan berat.
  let simulatedRawValue = 15075; // -> 150.75 kg

  const vector = {
    getInputRegister: function () {
      return simulatedRawValue;
    },
  };

  let server = new ModbusRTU.ServerTCP(vector, { host: '127.0.0.1', port: 8501, unitID: 1 });
  console.log('=== Server Modbus TCP tiruan jalan di 127.0.0.1:8501 ===\n');

  const scaleConfig = {
    dbId: 1,
    code: 'TIMBANGAN-01',
    host: '127.0.0.1',
    tcpPort: 8501,
    unitId: 1,
    registerAddress: 0,
    registerLength: 1,
  };

  const worker = createScaleWorker({
    scaleConfig,
    models: mockModels,
    pollIntervalMs: 200, // dipercepat khusus untuk test
    modbusTimeoutMs: 500,
    generateSyncId: uuidv4,
  });

  console.log('--- FASE 1: baca normal (harus muncul weight 150.75) ---');
  worker.start();
  await wait(1100);

  console.log('\n--- FASE 2: nilai berat berubah (harus muncul weight 200) ---');
  simulatedRawValue = 20000; // -> 200.00 kg
  await wait(400);

  console.log('\n--- FASE 3: simulasi koneksi terputus (server dimatikan, harus muncul status error) ---');
  await new Promise((resolve) => server.close(resolve));
  await wait(1000);

  console.log('\n--- FASE 4: server hidup lagi (harus auto-reconnect, status balik connected) ---');
  server = new ModbusRTU.ServerTCP(vector, { host: '127.0.0.1', port: 8501, unitID: 1 });
  await wait(700);

  await worker.stop();
  await new Promise((resolve) => server.close(resolve));

  console.log('\n=== TEST SELESAI (cek manual dari log di atas) ===');
}

main().catch((err) => {
  console.error('TEST GAGAL:', err);
  process.exit(1);
});