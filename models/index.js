'use strict';

const { DataTypes } = require('sequelize');

const defineScale = require('./scale');
const defineScaleReading = require('./scaleReading');
const defineScaleStatus = require('./scaleStatus');
const defineScaleStatusLog = require('./scaleStatusLog');
const defineUser = require('./user');

/**
 * Definisikan semua model pada satu instance Sequelize dan pasang
 * asosiasinya. Dipanggil terpisah untuk sequelizeLocal maupun
 * sequelizeOnline (masing-masing punya registry model sendiri-sendiri,
 * tidak saling bentrok walau nama modelnya sama).
 *
 * PENTING: tabel-tabel ini sudah dibuat lewat schema SQL
 * (gudang_pupuk.txt) di kedua database. Jangan panggil
 * `sequelize.sync({ alter: true })` atau `{ force: true }` di
 * production - itu bisa mengubah/menghapus kolom yang sudah ada.
 * Modul ini hanya mendefinisikan model untuk query, bukan migrasi.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @param {object} [options]
 * @param {boolean} [options.includeSyncTracking] - set true HANYA untuk
 *   sequelizeLocal. Menambahkan kolom `synced_at` (dan `sync_id` untuk
 *   ScaleStatusLog) yang dipakai sync worker. Untuk sequelizeOnline,
 *   biarkan default (false) - sync_id tetap ada di ScaleStatusLog karena
 *   dibutuhkan kedua sisi, tapi synced_at tidak.
 */
function initModels(sequelize, options = {}) {
  const { includeSyncTracking = false } = options;

  const Scale = defineScale(sequelize, DataTypes);
  const ScaleReading = defineScaleReading(sequelize, DataTypes, { includeSyncTracking });
  const ScaleStatus = defineScaleStatus(sequelize, DataTypes, { includeSyncTracking });
  const ScaleStatusLog = defineScaleStatusLog(sequelize, DataTypes, { includeSyncTracking });
  const User = defineUser(sequelize, DataTypes);

  // --- Asosiasi ---
  // Catatan: FK constraint sesungguhnya sudah ada di level DB (dibuat
  // lewat schema SQL). Asosiasi di sini murni untuk kemudahan query
  // (mis. Scale.findAll({ include: 'readings' })).
  Scale.hasMany(ScaleReading, {
    foreignKey: 'scale_id',
    as: 'readings',
    onDelete: 'CASCADE',
  });
  ScaleReading.belongsTo(Scale, {
    foreignKey: 'scale_id',
    as: 'scale',
  });

  Scale.hasOne(ScaleStatus, {
    foreignKey: 'scale_id',
    as: 'currentStatus',
    onDelete: 'CASCADE',
  });
  ScaleStatus.belongsTo(Scale, {
    foreignKey: 'scale_id',
    as: 'scale',
  });

  Scale.hasMany(ScaleStatusLog, {
    foreignKey: 'scale_id',
    as: 'statusLogs',
    onDelete: 'CASCADE',
  });
  ScaleStatusLog.belongsTo(Scale, {
    foreignKey: 'scale_id',
    as: 'scale',
  });

  return { Scale, ScaleReading, ScaleStatus, ScaleStatusLog, User };
}

module.exports = { initModels };
