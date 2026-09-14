-- =========================================================
-- Skema Database MySQL - Sistem Monitoring Timbangan
-- VERSI: DATABASE LOKAL
-- =========================================================
-- File ini untuk instalasi BARU (database kosong). Sudah
-- mencakup semua kolom tambahan untuk kebutuhan sinkronisasi
-- ke database online (synced_at, sync_id) - tidak perlu lagi
-- menjalankan file di folder migrations/ setelah ini.
--
-- Kolom yang HANYA ada di versi LOKAL ini (tidak ada di
-- schema database ONLINE): synced_at di scale_readings,
-- scale_status, dan scale_status_logs.
-- =========================================================

-- -------------------------------------------------
-- 0. Buat database jika belum ada
-- -------------------------------------------------
CREATE DATABASE IF NOT EXISTS gudang_pupuk
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gudang_pupuk;

-- -------------------------------------------------
-- 1. Tabel scales
-- Data master/konfigurasi untuk setiap timbangan
-- -------------------------------------------------
CREATE TABLE scales (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Kode unik timbangan, contoh: TIMBANGAN-01',
  name VARCHAR(100) NOT NULL COMMENT 'Nama/label timbangan',
  location VARCHAR(150) NULL COMMENT 'Lokasi fisik timbangan (opsional)',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- 2. Tabel scale_readings
-- Data berat (time-series) hasil pembacaan timbangan
-- -------------------------------------------------
CREATE TABLE scale_readings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sync_id CHAR(36) NOT NULL UNIQUE COMMENT 'UUID dibuat di sisi aplikasi (bukan auto_increment) - kunci idempoten saat sinkronisasi database lokal ke cloud, supaya retry tidak menghasilkan data ganda',
  scale_id INT UNSIGNED NOT NULL,
  weight DECIMAL(12,3) NOT NULL COMMENT 'Berat hasil timbang',
  recorded_at DATETIME NOT NULL COMMENT 'Waktu berat dibaca dari alat',
  synced_at DATETIME NULL COMMENT 'HANYA di DB lokal. Waktu berhasil disinkron ke DB online. NULL = belum disinkron.',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reading_scale FOREIGN KEY (scale_id) REFERENCES scales(id) ON DELETE CASCADE,
  INDEX idx_scale_recorded (scale_id, recorded_at),
  INDEX idx_scale_readings_synced_at (synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- 3. Tabel scale_status
-- Status TERKINI setiap timbangan (1 baris per timbangan, di-UPDATE)
-- -------------------------------------------------
CREATE TABLE scale_status (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scale_id INT UNSIGNED NOT NULL UNIQUE,
  status ENUM('connected','disconnected','error','unknown') NOT NULL DEFAULT 'unknown',
  last_connected_at DATETIME NULL COMMENT 'Waktu terakhir kali status connected',
  last_error_message VARCHAR(500) NULL COMMENT 'Pesan error terakhir jika ada',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  synced_at DATETIME NULL COMMENT 'HANYA di DB lokal. Waktu terakhir status ini dipush ke online. Perlu sync ulang kalau updated_at > synced_at.',
  CONSTRAINT fk_status_scale FOREIGN KEY (scale_id) REFERENCES scales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- 4. Tabel scale_status_logs
-- Riwayat / audit trail setiap perubahan status timbangan
-- -------------------------------------------------
CREATE TABLE scale_status_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sync_id CHAR(36) NOT NULL UNIQUE COMMENT 'UUID dibuat di sisi aplikasi - kunci idempoten saat sync (sama pola dgn scale_readings)',
  scale_id INT UNSIGNED NOT NULL,
  status ENUM('connected','disconnected','error','unknown') NOT NULL,
  message VARCHAR(500) NULL COMMENT 'Pesan error / keterangan tambahan jika ada',
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Waktu perubahan status terjadi',
  synced_at DATETIME NULL COMMENT 'HANYA di DB lokal. Waktu berhasil disinkron ke DB online. NULL = belum disinkron.',
  CONSTRAINT fk_statuslog_scale FOREIGN KEY (scale_id) REFERENCES scales(id) ON DELETE CASCADE,
  INDEX idx_scale_occurred (scale_id, occurred_at),
  INDEX idx_scale_status_logs_synced_at (synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- 5. Tabel users
-- Daftar pengguna sistem
-- -------------------------------------------------
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NULL UNIQUE COMMENT 'Opsional, tapi harus unik jika diisi',
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','operator','admin','dev') NOT NULL DEFAULT 'user',
  last_login DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------
-- Seed data: 4 timbangan
-- -------------------------------------------------
INSERT INTO scales (id, code, name) VALUES
(1, 'TIMBANGAN-01', 'Timbangan 1'),
(2, 'TIMBANGAN-02', 'Timbangan 2'),
(3, 'TIMBANGAN-03', 'Timbangan 3'),
(4, 'TIMBANGAN-04', 'Timbangan 4');

INSERT INTO scale_status (scale_id, status)
SELECT id, 'unknown' FROM scales;
