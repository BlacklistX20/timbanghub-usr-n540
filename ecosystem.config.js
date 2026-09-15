'use strict';

module.exports = {
  apps: [
    {
      name: 'gudang-pupuk-timbangan',
      script: './index.js',
      cwd: __dirname,

      // PENTING: instances HARUS 1, exec_mode HARUS 'fork'.
      // JANGAN diubah ke cluster / instances > 1 - arsitektur worker ini
      // (lihat workers/scaleWorker.js & workers/syncWorker.js) dirancang
      // sebagai 1 proses tunggal yang urus semua timbangan lewat loop
      // asinkron. Kalau di-cluster, tiap instance akan buka koneksi
      // Modbus TCP sendiri-sendiri ke port yang sama & insert reading
      // dobel ke database.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      watch: false,

      env: {
        NODE_ENV: 'production',
      },

      // Log dipisah error vs output biasa, masing-masing diberi prefix
      // tanggal & waktu di tiap barisnya.
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};