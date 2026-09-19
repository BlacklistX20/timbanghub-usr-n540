const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Registrasi plugin yang dibutuhkan untuk manipulasi zona waktu
dayjs.extend(utc);
dayjs.extend(timezone);

// Tetapkan zona waktu secara eksplisit
const TZ = 'Asia/Makassar';

function getTodayRange() {
  const startOfToday = dayjs().tz(TZ).startOf('day').toDate();
  const startOfTomorrow = dayjs().tz(TZ).add(1, 'day').startOf('day').toDate();

  return { startOfToday, startOfTomorrow };
}

// Tambahan fungsi untuk mengambil waktu saat ini sesuai zona waktu
function getCurrentTime() {
  return dayjs().tz(TZ).toDate();
}

module.exports = {
  getTodayRange,
  getCurrentTime,
  dayjs
};