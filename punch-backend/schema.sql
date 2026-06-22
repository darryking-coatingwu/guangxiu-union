-- 廣修打卡資料表
CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp        TEXT    NOT NULL,          -- 打卡人員
  type       TEXT    NOT NULL,          -- 'in'=上班, 'out'=下班
  lat        REAL,                      -- 緯度
  lng        REAL,                      -- 經度
  acc        INTEGER,                   -- 定位誤差(公尺)
  punched_at TEXT    NOT NULL           -- 打卡時間(ISO字串, UTC)
);
CREATE INDEX IF NOT EXISTS idx_punches_at  ON punches(punched_at);
CREATE INDEX IF NOT EXISTS idx_punches_emp ON punches(emp);
