'use strict';

module.exports = function defineScale(sequelize, DataTypes) {
  return sequelize.define(
    'Scale',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        comment: 'Kode unik timbangan, contoh: TIMBANGAN-01',
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      location: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'scales',
      timestamps: true,
      underscored: true,
    }
  );
};
