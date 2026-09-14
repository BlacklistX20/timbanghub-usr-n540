'use strict';

require('dotenv').config();
const { Sequelize } = require('sequelize');

function requireEnv(key) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Konfigurasi database tidak lengkap: env "${key}" wajib diisi di .env`);
  }
  return value;
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {string|number} opts.port
 * @param {string} opts.database
 * @param {string} opts.username
 * @param {string} opts.password
 * @param {number} opts.retryMax - jumlah percobaan ulang otomatis dari Sequelize
 *   saat authenticate/query gagal karena masalah koneksi.
 */
function createSequelizeInstance({ host, port, database, username, password, retryMax }) {
  return new Sequelize(database, username, password, {
    host,
    port: Number(port),
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    retry: {
      max: retryMax,
    },
  });
}

// ---------------------------------------------------------
// Koneksi Database Lokal
// DB lokal seharusnya selalu bisa diakses (ada di jaringan yang
// sama dengan worker), jadi retry kecil wajar untuk redam
// gangguan sesaat (mis. MySQL service baru restart).
// ---------------------------------------------------------
const sequelizeLocal = createSequelizeInstance({
  host: requireEnv('DB_LOCAL_HOST'),
  port: requireEnv('DB_LOCAL_PORT'),
  database: requireEnv('DB_LOCAL_NAME'),
  username: requireEnv('DB_LOCAL_USER'),
  password: process.env.DB_LOCAL_PASSWORD || '',
  retryMax: 3,
});

// ---------------------------------------------------------
// Koneksi Database Online
// retryMax sengaja 0 (tidak retry otomatis dari Sequelize) karena
// cadence retry untuk DB online sudah diatur sendiri oleh worker
// sinkronisasi lewat SYNC_INTERVAL_MS - biar tidak dobel retry
// dan gagal/berhasilnya cepat diketahui untuk deteksi status internet.
// ---------------------------------------------------------
const sequelizeOnline = createSequelizeInstance({
  host: requireEnv('DB_ONLINE_HOST'),
  port: requireEnv('DB_ONLINE_PORT'),
  database: requireEnv('DB_ONLINE_NAME'),
  username: requireEnv('DB_ONLINE_USER'),
  password: process.env.DB_ONLINE_PASSWORD || '',
  retryMax: 0,
});

/**
 * Test satu koneksi Sequelize. Dipakai juga sebagai metode deteksi
 * status internet: kalau koneksi ke DB online gagal, dianggap offline
 * (sesuai keputusan sebelumnya - cek langsung dari gagal/berhasilnya
 * koneksi ke DB online, bukan ping terpisah).
 *
 * @param {Sequelize} sequelize
 * @param {string} label - untuk keperluan log, mis. 'local' / 'online'
 * @returns {Promise<boolean>}
 */
async function testConnection(sequelize, label) {
  try {
    await sequelize.authenticate();
    return true;
  } catch (err) {
    console.error(`[DB:${label}] Gagal konek: ${err.message}`);
    return false;
  }
}

/**
 * Tutup kedua koneksi dengan rapi, dipanggil saat proses worker
 * di-shutdown (mis. menangkap SIGINT/SIGTERM).
 */
async function closeConnections() {
  await Promise.all([
    sequelizeLocal.close().catch(() => {}),
    sequelizeOnline.close().catch(() => {}),
  ]);
}

module.exports = {
  sequelizeLocal,
  sequelizeOnline,
  testConnection,
  closeConnections,
};