-- Failed admin YubiKey taps, counted per admin (not per session). admin_key is
-- HMAC-SHA256 of the signed-in user id under a private deploy setting; no raw id is stored.
create table if not exists admin_yubi_taps (
  admin_key    text primary key,
  fails        integer not null,
  window_start bigint not null
);
