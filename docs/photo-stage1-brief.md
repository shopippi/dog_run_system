# 写真販売 段階1の作業の分け方

2026-11-01 · 段階0(土台)の担当 = 統合の担当

写真販売(`docs/photo-requirements.md`)の段階1を、4つの担当が同時に進めるための取り決めです。段階0で DB の形(マイグレーション 0021)と API の形(`packages/shared/src/photos/schemas.ts`)を凍結しました。各担当は、自分のファイルだけを触ります。

## 1. 全員の決まり

- **ほかの担当のファイルを変えない。** 下の「持つファイル」にないファイルを変えたくなったら、統合の担当に頼む。
- **DB の形・API の形を変えない。** マイグレーションの追加、`packages/shared/src/photos/schemas.ts`・`constants.ts`・`logic.ts` の変更、`settings.ts` の項目の追加、エンドポイントの追加・削除・パスの変更は、統合の担当に戻す(理由と案を書いて頼む)。返す形に項目を「足す」だけでも戻す。
- **統合の担当のファイル**(段階1では読むだけ): `apps/api/migrations/0021_photo_sales.sql`、`packages/shared/src/photos/*`、`apps/api/src/lib/photos/*`(置き場所・Stripe・準備中・購入者)、`apps/api/src/routes/photos/index.ts`・`common.ts`・`mock-stripe.ts`、`apps/api/src/app.ts`、`apps/liff/src/pages/photos/PhotoRoutes.tsx`・`photos.css`・`PhotoSkeleton.tsx`、`apps/liff/src/components/photos/*`、`apps/admin/src/pages/photos/PhotoSalesFrame.tsx`・`AdminPhotoGrid.tsx`・`photos.css`、`apps/demo/src/seed/photos.ts`、`e2e/admin.photos-layout.spec.ts`・`liff.photos-layout.spec.ts`・`contrast-photos.spec.ts`、この文書と `docs/photo-requirements.md`。
  - 共通の部品(PhotoGrid など)に足りないものがあれば、自分の画面の中で包んで使うか、統合の担当に頼む。
- 自分のルートの関数は、いまある `todo`(501「準備中」)を中身に置き換える。ルートのファイルの中で、ほかのファイルを読み込む(新しい `services/photos/<担当>-*.ts` を作る)のは自由。
- サービスの新しいファイルは `apps/api/src/services/photos/` に、担当の頭を付けて作る(例: `admin-albums.ts`・`gallery.ts`・`checkout.ts`・`delivery.ts`)。
- 画面の見た目は `docs/design.md`。色を足さない(「AIっぽい」アクセントの色は使わない)。画面ごとの CSS は、その画面の隣に別のファイルで作る(`styles.css`・共通の `photos.css` は変えない)。
- CLAUDE.md の決まりを守る: 物理削除しない(例外は 3.8 のファイルだけ)、権限は API で確かめる、製作者は変更が 403、IT 用語を画面に出さない、エラーは「何が起きたか」と「次に何をすればよいか」。
- 管理者の変更は audit_log に残す(`auditStatement`)。元に戻せるものは `registerUndo` で戻せるようにする。
- テストを必ず付ける。Vitest は `apps/api/test/p8-<担当>-*.test.ts`、Playwright は `e2e/admin.photos-<担当>-*.spec.ts`・`e2e/liff.photos-<担当>-*.spec.ts`・`e2e/contrast-photos-<担当>.spec.ts`(この名前でないと playwright.config.ts の project に入らず、動かない)。新しい画面は、見え方(`checkScreen`)とコントラスト(`lowContrast`。ライトとダーク)の確かめを、自分の spec に入れる。
- 本物の Stripe・R2・LINE をテストで呼ばない。テストは代わりの置き場所とまねの Stripe で動く(`ENVIRONMENT = test`、`STRIPE_MOCK = 1`)。販売は既定で止まっているので、テストの最初に設定 `photo_sales_enabled` を true にする(`apps/api/test/p8-photo-access.test.ts` の `enablePhotoSales` を写して使う)。
- 終わったら、`pnpm typecheck`・`pnpm test`・自分の e2e が通ることを確かめ、日本語でコミットする。統合はしない(統合の担当がする)。

## 2. 1-A 管理(PA-2〜PA-5)

**持つファイル**

- `apps/api/src/routes/photos/admin-albums.ts`・`admin-upload.ts`・`admin-price-lists.ts`
- `apps/api/src/services/photos/admin-*.ts`(新しく作る)
- `apps/admin/src/pages/photos/PhotoUploadPage.tsx`・`PhotoAlbumsPage.tsx`・`PhotoAlbumEditPage.tsx`・`PhotoPriceListsPage.tsx`、その隣に作るファイル(`upload/*`・`album-edit.css` など。プレビュー・透かしを作る Web Worker もここ)
- `apps/api/test/p8-admin-*.test.ts`、`e2e/admin.photos-admin-*.spec.ts`・`e2e/contrast-photos-admin.spec.ts`

**作るエンドポイント**(形は `docs/photo-requirements.md` 6.2)

- アルバム: GET/POST `/admin/api/photos/albums`、POST `/albums/from-folders`、POST `/albums/publish`、GET/PATCH `/albums/:id`、POST `/albums/:id/publish`・`/remove`・`/restore`、POST `/albums/:id/photos/bulk`、GET `/photos/:photoId/thumb`・`/preview`
- アップロード: POST `/albums/:id/uploads`、GET `/uploads/:uploadId`、POST `/uploads/:uploadId/parts`・`/derivatives`・`/complete`、DELETE `/uploads/:uploadId`(代わりの置き場所の PUT の受け取り口は `common.ts` に作ってある)
- 価格表: GET/POST `/price-lists`、PATCH `/price-lists/:id`、PUT `/price-lists/defaults`

**作る画面**: PA-2 アップロード、PA-3 アルバム一覧、PA-4 アルバム編集、PA-5 価格表(どれも `PhotoSalesFrame` の中)。

**要点**

- フォルダを落とす → `parseFolderName` でアルバムを決める(`/albums/from-folders`)→ ファイルを `classifyUploadFile` で選ぶ(飛ばした数を出す)→ `compareFileNames` の順に、同時に4枚(`PHOTO_UPLOAD_CONCURRENCY`)。
- ブラウザで: SHA-256(`sha256Hex`)、プレビュー・サムネイル・中サイズ(`PHOTO_DERIVATIVE_SPECS`、透かしは `photoWatermarkText` の文字を斜めのタイルで全面に。EXIF は入れない)。HEIC は heic2any(MIT)で変換してからプレビューを作る(原本は HEIC のまま)。原本はデコードしない。
- 原本は `partTarget` の URL へ部分ごとに PUT(R2 は ETag を読む。代わりの置き場所は応答の etag)。途中で切れたら `GET /uploads/:id` の parts から続ける。Uppy(MIT)を使ってもよいし、小さな自前の送り手でもよい(部品を足すなら MIT か同等のものだけ)。
- 完了のとき、サーバーで `storage.sha256(original_key)` を計算して比べる。合わなければ `photos.hash_mismatch_at`。プレビューなどは `storage.head` で届いたことを確かめる。完了した写真は `album_photos`(下書き、並び順はファイル名の順)。
- 同じアルバムに同じ SHA-256 があれば duplicate(飛ばす)。
- 一括操作: 売れた写真(有効な権利がある写真)は remove できない → hide にして skipped に理由。move・copy は同じ photos の行を共有する(原本は1つ)。
- 価格表を変えると、使っているアルバムにすぐ反映(価格は保存しない。見るたびに `resolvePhotoPrice`)。
- 公開: 下書きの写真を公開し、`album_photos.published_at`、アルバムの `published_at`(最初だけ)と `sale_ends_at`(`defaultSaleEndsAt(publishedAt, settings.photo_sale_months)`)。

**テスト**: フォルダの名前、重複、部分の送り先(R2 は署名つき URL・代わりの置き場所は Worker)、完了のハッシュの確かめ(合う・合わない)、一括操作(売れた写真は外せない)、価格表の反映、公開と販売終了の日、操作ログ、受付・製作者の 403。e2e: フォルダを落として(テスト用の小さな JPEG)アップロード → 公開まで。PA-2〜PA-5 の見え方とコントラスト。

## 3. 1-B ギャラリー(PU-2〜PU-4)

**持つファイル**

- `apps/api/src/routes/photos/gallery.ts`、`apps/api/src/services/photos/gallery.ts`(新しく作る)
- `apps/liff/src/pages/photos/AlbumsPage.tsx`・`AlbumPage.tsx`・`ViewerPage.tsx`、その隣に作るファイル(`gallery.css`・`viewer/*` など)
- 会員証のメニューの「写真」へのリンク(`apps/liff/src/pages/card/` のメニューの1行だけ。販売中のときだけ出す)
- `apps/api/test/p8-gallery-*.test.ts`、`e2e/liff.photos-gallery-*.spec.ts`・`e2e/contrast-photos-gallery.spec.ts`

**作るエンドポイント**: GET `/api/photos/albums`、GET `/api/photos/albums/:id`、GET `/api/photos/media/:albumId/:photoId/thumb`・`/preview`。

**作る画面**: PU-2 アルバム一覧(イベント/日付のタブ、年月の絞り込み、カバー写真)、PU-3 アルバム詳細(グリッド、購入済みの印、まるごと購入、販売終了日)、PU-4 ビューア(透かし付きのプレビュー、スワイプで前後)。

**要点**

- 公開中・販売中(`isOnSale`)のアルバムの、公開中の写真だけを返す。ほかは 404。購入者は `ensurePhotoCustomer`。購入済みは entitlements(revoked_at IS NULL)から。
- 画像は `useAuthedImage` で読む(`photoThumbUrl`・`photoPreviewUrl`)。サムネイルは遅延読み込み(画面に入ったら)。応答に `cache-control: private` を付ける(誰でも開ける URL にしない)。大きさ・透かしを選ぶ口は作らない。
- **複数選択(2026-11-01 追加)**: PU-3 のグリッドと PU-4 のビューアで、写真を複数選んで「カートに入れる」でまとめて入れる(`POST /api/photos/cart/items` に items をまとめて送る。この API は 1-C が作る。返る `CartAddResponse` の skipped を「すでにカートにあります」などで知らせる)。購入済みの写真は選べない。まるごと購入のボタンは `{ kind: 'album', albumId }` を入れる。カートの数をヘッダーの近くに出し、カート(`/photos/cart`)へ進める。選ぶ操作は `PhotoGrid` の `selecting`・`onToggle` を使う。
- 1-C の API ができる前は、`/api/photos/cart/items` が 501 を返す。画面はそのエラーを「準備中です」として出せばよい(結合は段階2で確かめる)。
- 長押しの保存の抑止は気休め(`PhotoGrid` に入っている)。
- 4G で最初の表示が2秒以内(写真の数が多いアルバムでも、最初の1画面分だけ先に読む)。

**テスト**: 公開中だけが見える(下書き・非公開・販売終了・外したは 404)、購入済みの印、ほかの人の購入は印にならない、画像の口は権限を確かめる、準備中は 503。e2e: アルバム一覧 → 詳細 → ビューアのスワイプ、複数選択してカートに入れる(1-C の前は 501 の表示)。PU-2〜PU-4 の見え方とコントラスト(スマホ 393×759 と小さい画面)。

## 4. 1-C 決済(PU-5・PU-6・PA-6)

**持つファイル**

- `apps/api/src/routes/photos/checkout.ts`・`webhook.ts`(署名の確かめの部分 `receiveStripeWebhook` は変えない。`handleStripeEvent` を作る)・`admin-orders.ts`
- `apps/api/src/services/photos/checkout.ts`・`webhook.ts`・`refund.ts`・`notify.ts`(新しく作る。購入完了の LINE のお知らせは `services/line-push.ts` の送り方と `LINE_SENT_IN_MONTH_SQL` の上限を使う)
- `apps/liff/src/pages/photos/CartPage.tsx`・`OrderPage.tsx`・`MockCheckoutPage.tsx`・`LegalPage.tsx`、その隣に作るファイル
- `apps/admin/src/pages/photos/PhotoOrdersPage.tsx`、その隣に作るファイル
- 法定表示の HTML(Worker から出す。`apps/api/src/routes/photos/legal-html.ts` を作り、統合の担当に `index.ts` へ足してもらう)
- `apps/api/test/p8-checkout-*.test.ts`・`p8-webhook-*.test.ts`・`p8-refund-*.test.ts`、`e2e/liff.photos-checkout-*.spec.ts`・`e2e/admin.photos-checkout-*.spec.ts`・`e2e/contrast-photos-checkout.spec.ts`

**作るエンドポイント**: GET `/api/photos/cart`、POST `/api/photos/cart/items`、DELETE `/api/photos/cart/items/:itemId`、POST `/api/photos/checkout`、GET `/api/photos/orders`・`/orders/:id`、POST `/api/photos/stripe/webhook` の中身、GET `/admin/api/photos/orders`・`/orders/:id`、POST `/admin/api/photos/orders/:id/refund`。

**作る画面**: PU-5 カート(とまねの支払いの画面)、PU-6 購入完了、PA-6 注文(一覧・内容・返金・ダウンロードの記録)、法定表示。

**要点(カート。2026-11-01 追加)**

- カートはサーバー側の `cart_items`(購入者ごと。LIFF を開き直しても、別の端末でも同じ)。1行 = 写真1枚 か アルバムまるごと。同じアルバムの何枚でも、別のアルバムでも、まるごとと1枚ずつを混ぜてもよい。
- 入れる: 複数をまとめて(`cartAddSchema`。`dedupeCartItems` で重なりを除く)。同じ写真(別のアルバムからでも)・同じまるごとは1つだけ(一意の索引。ぶつかったら skipped `already_in_cart`)。販売終了・非公開・購入済み・まるごとの価格がないものは入れず skipped。
- 外す: 1行ずつ(`removed_at`。行は消さない)。
- 見る: 見るたびに DB から価格(`resolvePhotoPrice`・`resolveAlbumPrice`)と買えるかを調べ、`cartLineStates` で ok / redundant(まるごとに含まれる。「アルバムまるごとに含まれています」。請求しない)/ unavailable(販売終了・非公開・外した・購入済み・まるごとの価格なし。理由を出す)。合計は ok の行だけ(`cartTotal`)。
- 購入手続き: もう一度すべて確かめ、ok の行だけで注文(orders 1行・order_items 複数)と、1つの Checkout Session(明細は複数)を作る。除いた行は `excludedItemIds`。ok が無ければ 409 `cart_empty`。送信の印(Idempotency-Key と `orders.request_key`)で二重に作らない。カートの行はお支払いの確定まで残す。

**要点(決済・返金)**

- Stripe は `requireStripe(c)`。本番は本物、local・test・デモはまね(`/liff/photos/mock-checkout/:sessionId` へ移る。まねの API は `mock-stripe.ts` にある)。success_url・cancel_url は `photoSuccessUrl`・`photoCancelUrl`。
- Webhook(`handleStripeEvent`): `webhook_events` に入れてから処理(同じイベントは1回)。completed → 金額を確かめ、paid、権利(まるごとは `albumEntitlementPhotoIds`)、`photos.purchased_key` が無ければ `newPhotoKey('purchased', …)` へ `storage.copy` して `storage.sha256` で確かめる、カートの行に `ordered_at`・`order_id`、LINE のお知らせ。expired → expired。charge.refunded → 権利を無効に。処理に失敗したら 500 を返す(Stripe が送り直す)。`webhook_events.status` を failed に。
- PU-6: pending のあいだは「お支払いを確かめています」と出し、少し待って読み直す(Webhook が来るまで)。success_url を開いただけでは確定しない。
- 返金(PA-6): `refundEligibility` を満たす明細だけ選べる。条件の外は「条件の外で返金する」と理由(管理者だけ。`refund_override`、audit_log の reason)。`stripe.createRefund`(送信の印は明細ごと)→ 明細に返金の日時・額、権利の `revoked_at`、注文の状態(refunded / partially_refunded)と `refunded_amount`。
- 法定表示: `GET /api/photos/legal` の中身を、LIFF の画面と、ログインなしで開ける HTML の両方で出す。

**テスト**: カート(複数・混ぜる・同じ写真は1つ・まるごとに含まれる行は請求しない・買えなくなった行は除く・ほかの人のカートは触れない・開き直しても同じ)、購入手続き(金額はサーバー・明細が複数の Checkout・送信の印)、Webhook(まねの支払いの道で通しで: 権利・購入済み領域のコピーと SHA-256・同じイベントの二度目は何もしない・金額が違えば確定しない)、返金(7日・ダウンロード済み・条件の外は理由が要る・権利の無効化)、LINE のお知らせ(上限の合算、local は送ったつもり)、受付・製作者の 403。e2e: 複数の写真とまるごとをカートに入れる → まねの支払い → 購入完了。PU-5・PU-6・PA-6 の見え方とコントラスト。

## 5. 1-D 配信(PU-7・PA-1・PA-7・販売終了)

**持つファイル**

- `apps/api/src/routes/photos/delivery.ts`・`admin-dashboard.ts`
- `apps/api/src/services/photos/delivery.ts`・`zip.ts`・`sale-end.ts`(いまのつなぎ口を中身に置き換える)・`dashboard.ts`
- `apps/liff/src/pages/photos/PurchasedPage.tsx`、その隣に作るファイル
- `apps/admin/src/pages/photos/PhotoDashboardPage.tsx`・`PhotoSettingsPage.tsx`、その隣に作るファイル
- `apps/api/test/p8-delivery-*.test.ts`・`p8-sale-end-*.test.ts`、`e2e/liff.photos-delivery-*.spec.ts`・`e2e/admin.photos-delivery-*.spec.ts`・`e2e/contrast-photos-delivery.spec.ts`

**作るエンドポイント**: GET `/api/photos/purchases`、GET `/api/photos/purchases/:photoId/view`、POST `/api/photos/purchases/:photoId/download`、POST `/api/photos/purchases/zip`、GET `/api/photos/files/zip/:token`、GET `/admin/api/photos/dashboard`。PA-7 は既存の GET/PATCH `/admin/api/settings` の photo_ の項目を使う。

**作る画面**: PU-7 購入した写真、PA-1 ダッシュボード、PA-7 写真販売の設定。

**要点**

- 判定は entitlements(revoked_at IS NULL)だけ。中サイズ(view_key)は権利がある人だけ、Worker から出す。
- ダウンロード: `downloadAllowance(…, settings.photo_download_limit)` で確かめ、`download_logs` に残し(IP は `userHashOf` のようにハッシュ)、`storage.downloadUrl({ key: purchased_key, filename: original_filename, … })`(5分)。上限なら 429 `download_limit` と、いつからまたできるか(`resetsAt`)。
- ZIP: 無圧縮(stored)で、原本をつなげて流す(デコードしない)。100枚まで。1枚ずつ回数に数える。R2 のときも Worker が `storage.get` で読んで流す。受け取り口は HMAC の署名(`signFileToken`・`fileTokenSecret`)で5分。
- 販売終了の自動処理(`runPhotoSaleEnd`。毎晩 3:10 に `cron.ts` から呼ばれる): 7日前のお知らせ(`isDeletionNoticeDue`、`albums.deletion_notice_at`)、終了(`ended_at`)、売れなかった写真のファイルを消す(`storage.delete`、`photos.files_deleted_at`。ほかの販売中のアルバムに載っている写真・`purchased_key` は消さない)。`system_jobs` に `photo_sale_end` として残す: `SYSTEM_JOB_NAMES`・`SYSTEM_JOB_LABELS`(packages/shared)と `EXPECTED`(services/system-status.ts)に足すのは、統合の担当に頼む(既存のファイルのため)。
- PA-1: 今月の売上(返金を引く)・枚数・注文数、販売終了が近いアルバム(延長は PA-4 へのリンク)、最新の注文、準備中の理由、ハッシュが合わなかった写真・ダウンロードの上限を超えた件数。
- PA-7: 販売する・止める(置き場所・決済がそろっていなければ、理由を出して押せない)、透かしの文字(空なら「施設の名前 SAMPLE」の見本)、販売期間、削除の前のお知らせ、ダウンロードの上限、返金の期間、購入完了のお知らせ、特定商取引法に基づく表記・利用規約の本文。既存の `SettingsKit` の部品と、予約の設定(`BookingSettingsPage`)の作り方に合わせる。

**テスト**: 権利がない・返金した写真は取れない、ほかの人の写真は取れない、5分の URL(代わりの置き場所で受け取ってバイト単位で同じ)、回数の上限(24時間で10回・設定で変わる)、ZIP の中身が原本と同じ(SHA-256)、販売終了(お知らせ・終了・売れなかったファイルだけ消える・売れた写真と購入済み領域は残る・ほかのアルバムに載っている写真は残る・行は残る)、ダッシュボードの数、受付・製作者の 403。e2e: 購入した写真 → ダウンロード、PA-1・PA-7。見え方とコントラスト。

## 6. 担当のあいだの受け渡し

| 受け渡し | 出す側 | 受ける側 | 段階1のあいだ |
| --- | --- | --- | --- |
| 公開した写真(album_photos・photos) | 1-A | 1-B・1-C・1-D | テストでは DB に直接入れて準備する(`apps/demo/src/seed/photos.ts` の形を参考に) |
| カートに入れる API | 1-C | 1-B | 1-B の画面は 501 を「準備中」と出せばよい |
| 権利(entitlements)と purchased_key | 1-C | 1-D | 1-D のテストでは DB と代わりの置き場所に直接入れて準備する |
| 販売終了の処理の system_jobs の名前 | 1-D | 統合 | 統合の担当が段階2で足す |

段階2(統合)で、通しの e2e(アップロード → 公開 → カート → まねの支払い → ダウンロードの SHA-256 が原本と一致)と、別のエージェントによるセキュリティのレビュー(`docs/photo-requirements.md` 12章)をします。
