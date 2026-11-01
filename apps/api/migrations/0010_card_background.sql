-- 担当I: 会員証の背景(C-06、docs/design.md 5章、docs/changes-2026-10-28.md 8章)
-- 追加だけ(既存の列は変えない)。
-- JSON: {"kind":"preset","color":"ink"|"navy"|"forest"|"brown"|"wine"|"gray"|"sand"|"white"}
--    か {"kind":"photo","key":"cards/<household_id>/<uuid>.jpg"}。NULL は初期値(墨の単色)。
-- 前の写真は R2 から消さず、変更は操作ログ(audit_log、action = 'household.card_background')に前後の値を残す。
ALTER TABLE households ADD COLUMN card_background TEXT;
