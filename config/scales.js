'use strict';

require('dotenv').config();

/**
 * Deteksi semua index timbangan yang ada di .env berdasarkan pola
 * SCALE_<n>_DB_ID. Dibuat dinamis (bukan hardcode 1-4) supaya kalau
 * nanti jumlah timbangan berubah, cukup tambah/hapus blok di .env
 * tanpa perlu ubah kode ini.
 */
function detectScaleIndexes() {
  const indexes = new Set();
  const pattern = /^SCALE_(\d+)_DB_ID$/;

  for (const key of Object.keys(process.env)) {
    const match = key.match(pattern);
    if (match) {
      indexes.add(Number(match[1]));
    }
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

function requireEnv(key) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Konfigurasi timbangan tidak lengkap: env "${key}" wajib diisi di .env`);
  }
  return value;
}

function requireEnvInt(key) {
  const raw = requireEnv(key);
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Konfigurasi timbangan tidak valid: env "${key}" harus berupa angka bulat, didapat "${raw}"`);
  }
  return value;
}

function buildScaleConfig(index) {
  const prefix = `SCALE_${index}_`;

  return {
    index,
    dbId: requireEnvInt(`${prefix}DB_ID`),
    code: requireEnv(`${prefix}CODE`),
    host: requireEnv(`${prefix}HOST`),
    tcpPort: requireEnvInt(`${prefix}TCP_PORT`),
    unitId: requireEnvInt(`${prefix}UNIT_ID`),
    registerAddress: requireEnvInt(`${prefix}REGISTER_ADDRESS`),
    registerLength: requireEnvInt(`${prefix}REGISTER_LENGTH`),
  };
}

/**
 * Cek tidak ada dua timbangan yang memakai kombinasi host+port yang sama.
 * Ini murni validasi konfigurasi (typo env), bukan pengecekan alat fisik.
 */
function assertNoPortConflict(scales) {
  const seen = new Map(); // key: "host:tcpPort" -> code

  for (const scale of scales) {
    const key = `${scale.host}:${scale.tcpPort}`;
    if (seen.has(key)) {
      throw new Error(
        `Konflik konfigurasi: timbangan "${scale.code}" dan "${seen.get(key)}" memakai host+port yang sama (${key})`
      );
    }
    seen.set(key, scale.code);
  }
}

/**
 * Load dan validasi semua konfigurasi timbangan dari .env.
 * @returns {Array<{
 *   index: number,
 *   dbId: number,
 *   code: string,
 *   host: string,
 *   tcpPort: number,
 *   unitId: number,
 *   registerAddress: number,
 *   registerLength: number
 * }>}
 */
function loadScalesConfig() {
  const indexes = detectScaleIndexes();

  if (indexes.length === 0) {
    throw new Error(
      'Tidak ada konfigurasi timbangan ditemukan di .env. Pastikan minimal ada SCALE_1_DB_ID, SCALE_1_CODE, dst.'
    );
  }

  const scales = indexes.map(buildScaleConfig);
  assertNoPortConflict(scales);

  return scales;
}

module.exports = {
  loadScalesConfig,
};