'use strict';

/**
 * @param {import('sequelize').Sequelize} sequelize
 * @param {import('sequelize').DataTypes} DataTypes
 * @param {object} [options]
 * @param {boolean} [options.includeSyncTracking] - true untuk DB LOKAL saja.
 *   Menambahkan kolom `synced_at` yang tidak ada di DB online (DB online
 *   adalah tujuan sinkron, tidak perlu tahu status sync-nya sendiri).
 */
module.exports = function defineScaleReading(sequelize, DataTypes, options = {}) {
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
      // SENGAJA TIDAK diberi defaultValue di sini.
      // sync_id HARUS di-generate SEKALI oleh worker (pakai package
      // `uuid`, mis. uuidv4()) lalu dipakai untuk insert ke DB lokal
      // MAUPUN DB online dengan nilai yang SAMA. Ini kunci mekanisme
      // idempoten saat sinkronisasi (retry insert ke online tidak akan
      // membuat data duplikat). Kalau dibiarkan auto-generate di level
      // model, tiap DB akan generate UUID berbeda-beda dan
      // idempotensinya rusak.
    },
    scale_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    weight: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      comment: 'Berat hasil timbang (kg)',
    },
    recorded_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Waktu berat dibaca dari alat',
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

  return sequelize.define('ScaleReading', attributes, {
    tableName: 'scale_readings',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false, // tabel ini tidak punya kolom updated_at
  });
};
