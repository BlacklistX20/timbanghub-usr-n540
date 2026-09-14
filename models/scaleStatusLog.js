'use strict';

/**
 * @param {import('sequelize').Sequelize} sequelize
 * @param {import('sequelize').DataTypes} DataTypes
 * @param {object} [options]
 * @param {boolean} [options.includeSyncTracking] - true untuk DB LOKAL saja
 *   (kolom synced_at). Kolom sync_id berbeda dari synced_at: sync_id WAJIB
 *   ada di KEDUA database (lokal & online) karena dipakai sebagai kunci
 *   idempoten saat insert ke online - sama seperti pola di scale_readings.
 */
module.exports = function defineScaleStatusLog(sequelize, DataTypes, options = {}) {
  const { includeSyncTracking = false } = options;

  const attributes = {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    sync_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      // SENGAJA TIDAK diberi defaultValue - sama seperti sync_id di
      // ScaleReading, harus digenerate manual sekali oleh worker
      // (uuidv4()) lalu dipakai sama persis untuk insert ke lokal & online.
    },
    scale_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('connected', 'disconnected', 'error', 'unknown'),
      allowNull: false,
    },
    message: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    occurred_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      // Diberi defaultValue di sisi Sequelize (bukan cuma mengandalkan
      // DEFAULT CURRENT_TIMESTAMP di MySQL) karena Sequelize memvalidasi
      // allowNull di level JS SEBELUM query dikirim ke DB - kalau
      // dibiarkan tanpa default di sini, create() tanpa occurred_at
      // akan gagal validasi duluan sebelum sempat mengandalkan default
      // dari database.
    },
  };

  if (includeSyncTracking) {
    attributes.synced_at = {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      comment:
        'HANYA ada di DB lokal. Waktu berhasil disinkron ke DB online. NULL = belum disinkron.',
    };
  }

  return sequelize.define('ScaleStatusLog', attributes, {
    tableName: 'scale_status_logs',
    timestamps: false, // occurred_at dikelola manual/DB default, bukan Sequelize
    underscored: true,
  });
};
