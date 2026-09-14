'use strict';

/**
 * @param {import('sequelize').Sequelize} sequelize
 * @param {import('sequelize').DataTypes} DataTypes
 * @param {object} [options]
 * @param {boolean} [options.includeSyncTracking] - true untuk DB LOKAL saja.
 *   scale_status di-UPDATE terus (1 baris per timbangan), jadi sync worker
 *   membandingkan `updated_at` vs `synced_at`: kalau updated_at lebih baru,
 *   berarti perlu di-push ulang ke online.
 */
module.exports = function defineScaleStatus(sequelize, DataTypes, options = {}) {
  const { includeSyncTracking = false } = options;

  const attributes = {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    scale_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM('connected', 'disconnected', 'error', 'unknown'),
      allowNull: false,
      defaultValue: 'unknown',
    },
    last_connected_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_error_message: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  };

  if (includeSyncTracking) {
    attributes.synced_at = {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      comment:
        'HANYA ada di DB lokal. Waktu terakhir status ini dipush ke online. Perlu sync ulang kalau updated_at > synced_at.',
    };
  }

  return sequelize.define('ScaleStatus', attributes, {
    tableName: 'scale_status',
    timestamps: true,
    underscored: true,
    createdAt: false, // tabel ini tidak punya kolom created_at
    updatedAt: 'updated_at',
  });
};
