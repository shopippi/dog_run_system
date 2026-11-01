# 写真販売 要件定義書

Nov 1, 2026 · @bandvape

ドッグランで撮った写真の販売を、フォトレコから自前のしくみへ移します。既存のドッグラン LINE会員システム(`docs/requirements.md`)の中に作ります。同じ Worker・同じデータベース・同じドメインで、お客さんは LINE(LIFF)の中で写真を選んで買い、管理者は管理画面の「写真販売」で、フォルダを落とす・価格表を選ぶ・公開を押す、の3つで運用します。

> この文書は、Claude Code が実装に使う仕様書を兼ねます。機能ID(PF-1 など)・画面ID(PU-1・PA-1 など)は、実装・テスト・受け入れ確認で共通に使います。依頼主の元の仕様(Claude Doc「ドッグラン写真販売システム 要件定義書」2026-10-31)に、2026-11-01 の決定(2章)を当てはめたものです。食い違うときは、この文書が正です。

## 1. 概要・目的・スコープ

**解決したい課題**

- フォトレコでは写真の画質が下がり、運用も手間がかかる。
- 手数料型のサービスは、売上の15%以上が引かれる。

**ゴール**

- 購入者に届くファイルが、アップロードした原本とバイト単位で同じであること(必須)。
- 月50万円売れたときの手取りを約48万円にする(費用はほぼ Stripe の決済手数料 3.6% だけ)。
- ITに詳しくない管理者が、日々の操作を「フォルダを放り込む」「価格表を選ぶ」「公開を押す」で済ませられる。

**スコープ**

| 区分 | 内容 |
| --- | --- |
| 対象 | アルバム(日付・イベント)ごとの写真の販売、透かし付きのプレビュー、カート(複数の写真・アルバムまるごと)、オンライン決済(Stripe Checkout)、購入した写真の再ダウンロード、管理画面(アップロード・アルバム・価格表・注文・返金・設定) |
| 対象外 | プリント・発送、ポイントカードとの連動(将来検討)、撮影日での自動の振り分け、メールでの購入(将来。20章) |
| 前提 | 施設が販売者(Stripe のアカウント・特定商取引法に基づく表記は施設の名義)。製作者はしくみを提供するだけで、代金を預からない |

## 2. 決定事項(2026-11-01)

元の仕様と違うところは、こちらに従います。

| 番号 | 項目 | 決定 |
| --- | --- | --- |
| 1 | 置き場所 | 既存のシステムの中。同じ Worker・D1・ドメイン。購入者の画面は LIFF(apps/liff の `/photos…`)、管理画面は apps/admin の「写真販売」。管理者のログインは既存のスタッフのログインと権限(Cloudflare Access は使わない)。Refine・Drizzle・Better Auth は入れず、既存の作り方に合わせる |
| 2 | 写真の置き場所 | まだ決めない(依頼主が R2 を有効にしていない)。置き場所の部品(7章)を2つ作る: (a) R2(署名つき URL でブラウザから直接・5分の署名つき URL で受け取り)、(b) 代わりの置き場所(local・test・デモ。Worker を通して D1 に小分けに保存)。本番は R2 の設定がそろうまで「準備中」 |
| 3 | 決済 | Stripe Checkout と Webhook。秘密は wrangler の secret(配信のワークフローでは任意の Secret)。local・test は、まねの Stripe(LINE ログインのまねと同じ考え方。8.3)。テストで Stripe を呼ばない。npm の stripe は使わず fetch で REST API を呼び、Webhook の署名は Web Crypto で確かめる |
| 4 | 購入者のログイン | LINE だけ(既存の LIFF のログイン)。メールでの購入は将来。購入完了のお知らせは LINE のプッシュ(既存の line-push。予約のお知らせと同じ、ひと月の上限に数える) |
| 5 | 返金 | 購入から7日以内で、まだ一度もダウンロードしていない写真だけ受け付ける。管理画面の返金で確かめる。条件の外は、管理者が理由を書いて返金できる(操作ログに残す)。利用規約の本文の初期値に書く |
| 6 | 家族の共有 | しない。購入はその購入者(LINE アカウント)だけのもの。household_id は将来のために記録だけする |
| 7 | 価格の初期案 | 価格表「通常」1枚500円、「イベント」1枚800円。アルバムまるごとの価格は未設定。日付のアルバムの既定は「通常」、イベントのアルバムの既定は「イベント」(20章。管理画面で変えられる) |
| 8 | 透かし | 施設の名前 +「SAMPLE」(設定 facility_name から。photo_watermark_text で変えられる) |
| 9 | 販売期間 | 公開から6か月。終わったら、売れなかった写真の原本・プレビュー・サムネイル・中サイズのファイルを消す。これは「物理削除しない」の唯一の例外(3.8) |
| 10 | 原本 | バイト単位で同じことが必須。原本は一度もデコード・再エンコードしない。SHA-256 をブラウザで計算し、アップロードの後と購入済み領域へのコピーの後にサーバーで確かめる |
| 11 | 機能ID | 既存の ID と重ならないよう頭に P を付ける。機能 PF-1〜PF-8(元の F1〜F8)、購入者の画面 PU-1〜PU-7(元の U1〜U7)、管理画面 PA-1〜PA-7(元の A1〜A7) |
| 12 | カート(2026-11-01 追加) | カートはサーバー側(購入者ごと)。LIFF を開き直しても、別の端末でも同じ。同じアルバムの何枚でも、別のアルバムの写真も、アルバムまるごとと1枚ずつを混ぜても、1回の Stripe Checkout(明細は複数)で買える。3.9 |

**この文書で決めたこと(製作者の判断。変えるときは依頼主に確認する)**

| 項目 | 決め方 | 理由 |
| --- | --- | --- |
| 受付スタッフの権限 | 写真販売の画面と API は、見ることもできない(403)。メニューにも出さない | 注文にお客さんの名前と購入の内容が出るため。受付の仕事に要らない。製作者は見るだけ(変更は 403) |
| 購入者の表 | 家族(family_members)を使わず、photo_customers を新しく作る | 会員でない LINE ユーザーも買える。家族を抜けた・おうちをまとめたあとも、購入した写真は本人に残る。将来のメールでの購入も同じ表で扱える。会員なら family_member_id と household_id を記録だけする |
| ID | ほかの表と同じ INTEGER(連番)。置き場所のキーだけはランダムな UUID | 既存の書き方に合わせる。すべての API で「本人のものか」「公開中か」を確かめるので、番号を推測されても取れない |
| 操作ログ | 既存の audit_log を使う(admin_audit_logs は作らない) | 元に戻す・操作ログの画面・CSV が、そのまま使える |
| R2 のバケット | 1つ(photos)に、場所ごとの頭(originals/・purchased/・view/・preview/・thumb/)で分ける | 設定する値が減る。プレビューも Worker を通してしか出さないので、バケットを分ける意味が小さい。ライフサイクルのルールは頭ごとに付けられる |
| 購入済み領域のファイル | 写真1枚に1つ(photos.purchased_key)。最初に売れたときにコピーし、ほかの購入者も同じファイルを使う | 置き場所の費用。バイト単位で同じなので、購入者ごとに分ける必要がない |

## 3. 決まり

### 3.1 価格(PF-3)

- 価格は税込みの整数円。50円以上(Stripe の日本円の最低額)。
- 写真1枚の価格 = 写真ごとの例外価格(album_photos.price_override)があればそれ、なければアルバムの価格表の1枚の価格(`resolvePhotoPrice`)。
- アルバムまるごとの価格は、価格表にあるときだけ(なければ、まるごとでは買えない)。
- 価格表を変えると、使っている全アルバムにすぐ反映する。お支払い済みの注文の価格(order_items.unit_price)は変わらない。
- 金額は必ずサーバーが DB から計算する。画面から送られた金額・品物の名前は使わない。

### 3.2 販売期間(PF-1・PF-8)

- 販売終了の日時の既定 = 最初に公開した日時 + 6か月(設定 photo_sale_months。月末は、その月の最後の日に切る。`defaultSaleEndsAt`)。アルバムごとに延長できる。
- 販売中 = 公開中で、販売終了の日時より前(`isOnSale`)。
- 販売終了の7日前(設定 photo_deletion_notice_days)に、管理者に知らせる(PA-1 のダッシュボードに出す。メールは 20章)。
- 毎晩 3:10 の自動処理で、販売終了の日時を過ぎたアルバムを「販売終了」にし、売れなかった写真のファイルを消す(3.8)。販売終了のアルバムは、お客さんの一覧から消える(購入した写真の画面には残る)。

### 3.3 原本と画質(必須)

- 原本は、アップロードからダウンロードまで一度もデコード・再エンコードしない。サーバーには画像を変換する処理を持たない。
- ブラウザで原本の SHA-256 を計算して送り、DB(photos.sha256)に残す。
- アップロードの完了のとき、サーバーで原本の SHA-256 を計算し直して比べる(photos.sha256_verified_at)。購入済み領域へのコピーの後にも比べる(photos.purchased_verified_at)。合わなければ photos.hash_mismatch_at を入れ、管理者・製作者に知らせる(PA-1・システムの状態)。
- プレビュー(長辺1200px・JPEG 品質0.7・全面に斜めのタイルの透かし)、サムネイル(長辺400px・透かしあり)、中サイズ(長辺2048px・透かしなし。購入者だけ)は、アップロードのときにブラウザで作る。元の写真の EXIF は入れない。
- 統合のテスト(段階2)で、「アップロード → 購入 → ダウンロード」の SHA-256 が同じことを確かめる。

### 3.4 アルバムまるごとの購入(PF-6)

- お支払いが確定した時点(Webhook を処理した時点)で公開中の写真だけに、購入の権利を作る(`albumEntitlementPhotoIds`)。あとから足した写真・非公開・外した写真は含めない。すでに持っている写真には作らない。

### 3.5 返金(PF-6・PA-6)

- 受け付けるのは、購入(お支払いの確定)から7日以内(設定 photo_refund_days)で、その明細の写真を一度もダウンロードしていないもの(`refundEligibility`)。アルバムまるごとの明細は、含まれる写真のどれか1枚でもダウンロードしていれば対象外。
- 管理画面の返金(PA-6)は、条件を満たす明細だけを選べる。条件の外は、管理者が「条件の外で返金する」と理由を書いて返金できる(order_items.refund_override = 1、audit_log の reason)。
- 返金した明細の権利は無効にする(entitlements.revoked_at)。返金した写真はダウンロードできない。Stripe からの charge.refunded でも、同じように無効にする(二重にならないように)。
- 利用規約の本文の初期値(設定 photo_terms_text)に、この条件を書いておく。

### 3.6 LINE のお知らせ(購入完了)

- お支払いが確定したら、購入者の LINE に「ご購入ありがとうございます」と「購入した写真」へのリンクをプッシュで送る(services/line-push.ts と同じ送り方。設定 photo_notify_purchase で止められる)。
- 予約のお知らせと合わせて、ひと月の上限(設定 booking_notify.monthly_limit。無料のプランは月200通)に数える。数えるのは booking_notifications と photo_notifications の送った数の合計(`LINE_SENT_IN_MONTH_SQL`)。送れなくても注文は止めない。結果を photo_notifications に残す。
- local・test・デモでは LINE に送らない(「送ったつもり」で記録する)。

### 3.7 ダウンロード(PF-7)

- ダウンロードできるかは、購入の権利(entitlements。無効にしていないもの)だけで決める。
- 押すたびに、有効期限5分の URL を作る(R2 の署名つき URL、代わりの置き場所では Worker の署名つきの受け取り口)。
- 回数の上限: 写真1枚につき、24時間で10回まで(設定 photo_download_limit。`downloadAllowance`)。超えたら 429 と「○時ごろから、またダウンロードできます」。期間全体の上限は設けない。超えたことを管理者に知らせる(PA-6 のダウンロードの記録)。
- 複数枚は ZIP でまとめて(サーバーで無圧縮で結合。100枚まで)。
- 購入した写真は、販売終了のあとも、ずっと見られる。

### 3.8 物理削除の例外(ファイルだけ)

既存のシステムの決まりは「データを物理削除しない(例外は退会時の個人情報の削除だけ)」です。写真販売では、置き場所の費用のために、次の例外を1つだけ加えます。

- 販売期間が終わったアルバムの、**売れなかった写真のファイル**(原本・プレビュー・サムネイル・中サイズ)を、毎晩の自動処理で消す。ほかの販売中のアルバムにも載っている写真は消さない。
- 消すのはファイルだけ。DB の行(photos・album_photos・albums)は消さず、photos.files_deleted_at・albums.files_deleted_at を入れる。
- 業務の記録(注文・明細・購入の権利・ダウンロードの記録・アルバムへの掲載)は、決して消さない。状態と日時で表す。
- **購入済み領域のファイル(purchased/)は、決して消さない。** R2 のライフサイクルのルールは、取りこぼしの保険として originals/・preview/・thumb/ だけに付ける(view/ は売れた写真の中サイズを残すため、自動処理だけで消す)。
- そのほかに消すファイルは、途中でやめたアップロードの部分だけ(業務の記録ではない)。

### 3.9 カート(PF-6。2026-11-01 追加)

- カートはサーバー側(cart_items)で、購入者ごと。LIFF を開き直しても、別の端末でも同じ中身。
- 1行は「写真1枚」か「アルバムまるごと」。同じアルバムの何枚でも、別のアルバムの写真も、まるごとと1枚ずつも混ぜて入れられる。
- **入れる**: アルバムのグリッドやビューアで複数を選び、「カートに入れる」でまとめて入れる(POST /api/photos/cart/items。1回に200件まで)。**外す**: 1行ずつ(DELETE /api/photos/cart/items/:id。行は消さず removed_at を入れる)。
- **重なり**: 同じ写真は2回入らない(別のアルバムから入れても同じ写真なら1つ。DB の一意の索引で守る)。同じアルバムのまるごとも1つだけ。カートにアルバムまるごとがあると、そのアルバムに含まれる写真(いま公開中の写真)の1枚ずつの行は「まるごとに含まれています」の印を付けて見せ、請求しない(`cartLineStates` の redundant)。
- **買えなくなったもの**: 販売終了・非公開・アルバムから外した・購入済み・まるごとの価格がなくなった行は、印と理由を付けて見せ(unavailable)、購入手続きでは除く。
- **合計**: カートを見るたびに、サーバーが DB の価格で計算する(ok の行だけ)。カートには金額を保存しない。
- **購入手続き**: カートの ok の行を1つの注文(orders 1行・order_items 複数行)にし、1つの Stripe Checkout Session(明細は複数)を作る。お支払いが確定したら(Webhook)、注文に入れたカートの行に ordered_at・order_id を入れる(カートから消える)。お支払いをやめた・期限が切れたときは、カートはそのまま残る。
- 購入手続きの直前にも、もう一度すべて確かめる(見たときと購入手続きの間に販売終了になったもの)。

## 4. 役割と権限

| 操作 | 購入者(LINE) | 受付スタッフ | 管理者 | 製作者 |
| --- | --- | --- | --- | --- |
| 公開中のアルバム・写真を見る(透かし付き)・カート・購入 | ○(会員でなくてよい) | ― | ― | ― |
| 自分の注文・購入した写真・ダウンロード | ○(本人の分だけ) | ― | ― | ― |
| 写真販売の管理画面を見る(アルバム・注文・売上) | ― | ―(403) | ○ | ○ 見るだけ |
| アップロード・アルバム・価格表・公開・一括操作・返金・設定 | ― | ―(403) | ○ | ―(403) |
| 操作ログ・システムの状態 | ― | ― | ○ | ○ |

- 権限は API で確かめる(画面で隠すだけにしない)。管理画面の写真販売の API は `/admin/api/photos/*` にまとめ、`requireRole('admin')`(製作者は GET だけ通す)をかける。変更系は `requireStaff` が製作者を 403 にする。
- お客さん向けの API は、毎回 LINE の ID トークンをサーバーで確かめる(既存の requireLineUser)。注文・購入した写真・ダウンロードは、すべて「ログイン中の購入者のものか」を照合する(他人の番号を入れても取れない)。
- 閲覧もログインが要る(写真に客と犬が写るため)。

## 5. 機能ID と画面ID

| 機能ID | 元の仕様 | 機能 | 画面 |
| --- | --- | --- | --- |
| PF-1 | F1 | アルバム(日付/イベント、販売期間) | PA-3・PA-4 |
| PF-2 | F2 | 一斉アップロード(フォルダの名前でアルバムを作る、プレビュー・透かし、マルチパート、途中から再開、重複を飛ばす) | PA-2・PA-4 |
| PF-3 | F3 | 価格表(1枚・まるごと、種類ごとの既定、写真ごとの例外価格) | PA-5・PA-4 |
| PF-4 | F4 | 公開と一括操作(価格・非公開・公開・移す・コピー・外す) | PA-3・PA-4 |
| PF-5 | F5 | ギャラリー(アルバム一覧・詳細・ビューア、購入済みの印) | PU-2〜PU-4 |
| PF-6 | F6 | カートと決済(サーバー側のカート、Checkout、Webhook、返金) | PU-5・PU-6・PA-6 |
| PF-7 | F7 | 購入した写真と再ダウンロード(5分の URL、ZIP、回数の上限) | PU-7 |
| PF-8 | F8 | 販売期間と自動削除(毎晩の自動処理、7日前のお知らせ) | PA-1・PA-4 |

| 画面ID | 元の仕様 | 画面 | 対象 | 主な要素 | パス |
| --- | --- | --- | --- | --- | --- |
| PU-1 | U1 | 入口・準備中 | 購入者 | LINE のログイン(既存の LIFF)、販売が準備中なら「準備中」 | (すべての /photos) |
| PU-2 | U2 | アルバム一覧 | 購入者 | イベント/日付のタブ、年月の絞り込み、カバー写真 | /liff/photos |
| PU-3 | U3 | アルバム詳細 | 購入者 | サムネイルのグリッド、複数選択して「カートに入れる」、購入済みの印、まるごと購入、販売終了日 | /liff/photos/albums/:id |
| PU-4 | U4 | 写真ビューア | 購入者 | 透かし付きのプレビュー、スワイプで前後、カートに入れる | /liff/photos/albums/:id/photos/:photoId |
| PU-5 | U5 | カート | 購入者 | 行ごとの明細・印(まるごとに含まれる/買えない)・外す、合計、「購入手続きへ」(Stripe Checkout へ) | /liff/photos/cart(まねの支払いは /liff/photos/mock-checkout/:sessionId) |
| PU-6 | U6 | 購入完了 | 購入者 | 注文の確定の状況(Webhook を待つ間は「処理中」)、購入した写真へ | /liff/photos/orders/:id |
| PU-7 | U7 | 購入した写真 | 購入者 | アルバム別、透かしなしの中サイズ、原本のダウンロード、まとめて ZIP | /liff/photos/purchased |
| PA-1 | A1 | ダッシュボード | 管理者 | 今月の売上・枚数、販売終了が近いアルバム、最新の注文、準備中の理由 | /admin/photos |
| PA-2 | A2 | アップロード | 管理者 | フォルダのドラッグ&ドロップ、アルバムごとの進み具合、飛ばしたファイルの数 | /admin/photos/upload |
| PA-3 | A3 | アルバム一覧 | 管理者 | 状態・枚数・売上・販売終了日、まとめて公開 | /admin/photos/albums |
| PA-4 | A4 | アルバム編集 | 管理者 | 名前・種類・開催日・価格表・販売期間、写真のグリッド(複数選択 → 価格・非公開・移す・外す)、公開 | /admin/photos/albums/:id |
| PA-5 | A5 | 価格表 | 管理者 | 価格表を作る・変える、種類ごとの既定 | /admin/photos/price-lists |
| PA-6 | A6 | 注文 | 管理者 | 注文の一覧・内容、返金、ダウンロードの記録 | /admin/photos/orders(/:id) |
| PA-7 | A7 | 設定 | 管理者 | 販売する・止める、透かしの文字、特定商取引法に基づく表記・規約、販売期間の既定 | /admin/photos/settings |

ほかに、ログインなしで開ける「特定商取引法に基づく表記」「利用規約」「プライバシーポリシー」を置く(Stripe の審査に要る。9.3)。

## 6. API 一覧

形(入力と応答)は `packages/shared/src/photos/schemas.ts` の zod スキーマが正。段階0で凍結し、変えるときは統合の担当(段階0)に戻す。エラーは既存と同じ `{ error: { code, message, details } }` で、message は「何が起きたか」と「次に何をすればよいか」を日本語で書く。

お客さん向けの変更(POST・DELETE)は、既存と同じく送信の印(Idempotency-Key)を受け付け、同じ印の送信は1回だけ処理する。

### 6.1 お客さん向け(認証: LINE の ID トークン。/api/photos)

/config 以外は、販売が準備中なら 503 `photo_sales_unavailable`(`requirePhotoSales`)。

| メソッド | パス | 入力 → 応答 | 内容 | 機能ID | 主なエラー |
| --- | --- | --- | --- | --- | --- |
| GET | /api/photos/config | → PhotoConfigResponse | 販売が使えるか・施設の名前・返金の日数・ダウンロードの上限 | PU-1 | 401 |
| GET | /api/photos/albums | galleryAlbumsQuerySchema → GalleryAlbumsResponse | 公開中・販売中のアルバム(種類・年月で絞る)と、絞り込みの月 | PF-5 | 503 |
| GET | /api/photos/albums/:id | → GalleryAlbumDetail | アルバムの公開中の写真(価格・購入済み)、まるごと購入できるか | PF-5 | 404(公開中でない) |
| GET | /api/photos/media/:albumId/:photoId/thumb、/preview | → 画像(JPEG) | 透かし付きのサムネイル・プレビュー(公開中のアルバムの公開中の写真だけ)。大きさや透かしを選ぶ口は作らない | PF-5 | 404 |
| GET | /api/photos/cart | → CartResponse | カートの中身(行ごとの状態 ok/redundant/unavailable と理由)、合計 | PF-6 | ― |
| POST | /api/photos/cart/items | cartAddSchema → CartAddResponse | 複数をまとめて入れる(写真・まるごと)。入れなかったもの(入っていた・買えない・購入済み)を返す | PF-6 | 400 |
| DELETE | /api/photos/cart/items/:itemId | → CartResponse | 1行外す(removed_at) | PF-6 | 404(自分の行でない) |
| POST | /api/photos/checkout | checkoutSchema(空) → CheckoutResponse | カートの ok の行で注文を作り、1つの Checkout Session(明細は複数)の URL を返す | PF-6 | 409 `cart_empty`(買えるものがない)、503 `payments_not_configured` |
| GET | /api/photos/orders、/api/photos/orders/:id | → { orders: MyOrder[] }、{ order: MyOrder } | 自分の注文。pending なら画面は「処理中」で読み直す | PF-6 | 404 |
| GET | /api/photos/purchases | → PurchasesResponse | 購入した写真(アルバム別)、ダウンロードの残り | PF-7 | ― |
| GET | /api/photos/purchases/:photoId/view | → 画像(JPEG) | 透かしなしの中サイズ(権利がある人だけ) | PF-7 | 403 `not_entitled` |
| POST | /api/photos/purchases/:photoId/download | → DownloadResponse | 原本の5分の URL | PF-7 | 403 `not_entitled`、429 `download_limit` |
| POST | /api/photos/purchases/zip | zipRequestSchema → DownloadResponse | まとめて ZIP(100枚まで)の5分の URL | PF-7 | 403、429 |
| GET | /api/photos/mock-stripe/sessions/:sessionId | → 金額・明細・戻り先 | まねの支払いの画面の中身(local・test だけ。自分の注文だけ) | PF-6 | 404 |
| POST | /api/photos/mock-stripe/sessions/:sessionId/pay | → { webhookStatus, eventId, redirectUrl } | まねの「支払う」。署名つきの checkout.session.completed を Webhook の口に通す | PF-6 | 404、409 |
| POST | /api/photos/mock-stripe/sessions/:sessionId/cancel | → { redirectUrl } | まねの「やめる」(カートへ戻るだけ) | PF-6 | 404 |

### 6.2 管理画面向け(認証: スタッフのログイン。/admin/api/photos。管理者だけ、製作者は見るだけ、受付は 403)

| メソッド | パス | 入力 → 応答 | 内容 | 機能ID |
| --- | --- | --- | --- | --- |
| GET | /admin/api/photos/availability | → PhotoAvailability | 置き場所(r2/fallback/missing)・決済(live/mock/missing)・設定、準備中の理由 | PA-1・PA-7 |
| GET | /admin/api/photos/dashboard | → PhotoDashboardResponse | 今月の売上・枚数・注文数、販売終了が近いアルバム、最新の注文 | PA-1 |
| GET | /admin/api/photos/albums | albumListQuerySchema → AdminAlbumsResponse | アルバムの一覧(状態・種類・言葉で絞る) | PA-3 |
| POST | /admin/api/photos/albums | albumCreateSchema → { album } | アルバムを作る(価格表を省くと種類ごとの既定) | PF-1 |
| POST | /admin/api/photos/albums/from-folders | albumsFromFoldersSchema → AlbumsFromFoldersResponse | フォルダの名前からアルバムを作る(`parseFolderName`。同じ名前の下書きがあればそれを使う) | PF-2 |
| POST | /admin/api/photos/albums/publish | albumsBulkPublishSchema → BulkResult | まとめて公開 | PF-4 |
| GET / PATCH | /admin/api/photos/albums/:id | albumUpdateSchema → AdminAlbumDetail | アルバムの内容と写真、変更(販売期間の延長を含む) | PF-1 |
| POST | /admin/api/photos/albums/:id/publish | → AdminAlbumDetail | 公開(下書きの写真をまとめて公開。販売終了の既定を入れる) | PF-4 |
| POST | /admin/api/photos/albums/:id/remove、/restore | → { album } | 一覧から外す・戻す(売れた写真があれば外せない) | PF-1 |
| POST | /admin/api/photos/albums/:id/photos/bulk | albumPhotosBulkSchema → BulkResult | 一括操作(set_price・reset_price・publish・hide・remove・move・copy・reorder)。売れた写真は remove できず非公開だけ(skipped に理由) | PF-3・PF-4 |
| GET | /admin/api/photos/photos/:photoId/thumb、/preview | → 画像 | 管理画面の写真(クッキーで読む) | PA-4 |
| POST | /admin/api/photos/albums/:id/uploads | uploadStartSchema → UploadStartResponse | 1枚のアップロードを始める。同じアルバムに同じ SHA-256 があれば duplicate | PF-2 |
| GET | /admin/api/photos/uploads/:uploadId | → uploadStatusResponseSchema | 途中の状態(続きから送るため。送り終えた部分) | PF-2 |
| POST | /admin/api/photos/uploads/:uploadId/parts | uploadPartsSchema → uploadPartsResponseSchema | 原本の部分の送り先(R2 の署名つき URL、または Worker の URL) | PF-2 |
| PUT | /admin/api/photos/uploads/:uploadId/parts/:n | 本文 = 部分のバイト → { partNumber, etag } | 代わりの置き場所だけ: 部分を受け取る(1.9MB まで) | PF-2 |
| POST | /admin/api/photos/uploads/:uploadId/derivatives | uploadDerivativeSchema → UploadTarget | プレビュー・サムネイル・中サイズの送り先(Content-Type を固定) | PF-2 |
| PUT | /admin/api/photos/uploads/:uploadId/derivatives/:kind | 本文 = JPEG → { kind, bytes } | 代わりの置き場所だけ: プレビューなどを受け取る | PF-2 |
| POST | /admin/api/photos/uploads/:uploadId/complete | uploadCompleteSchema → uploadCompleteResponseSchema | 完了。サーバーで SHA-256 を確かめ、下書きとしてアルバムに入れる | PF-2 |
| DELETE | /admin/api/photos/uploads/:uploadId | → 204 | やめる(途中のファイルを消す。行は残す) | PF-2 |
| GET / POST | /admin/api/photos/price-lists | priceListCreateSchema → PriceListsResponse / { priceList } | 価格表の一覧・作る | PF-3 |
| PATCH | /admin/api/photos/price-lists/:id | priceListUpdateSchema → { priceList } | 変える・使わなくする(archived。消さない) | PF-3 |
| PUT | /admin/api/photos/price-lists/defaults | priceListDefaultsSchema → PriceListsResponse | 種類ごとの既定 | PF-3 |
| GET | /admin/api/photos/orders | adminOrdersQuerySchema → AdminOrdersResponse | 注文の一覧 | PA-6 |
| GET | /admin/api/photos/orders/:id | → AdminOrderDetail | 注文の内容、明細ごとの返金の可否、ダウンロードの記録 | PA-6 |
| POST | /admin/api/photos/orders/:id/refund | refundSchema → RefundResponse | 返金(条件の外は override と理由) | PF-6 |
| GET / PATCH | /admin/api/settings | photo_ で始まる項目 | 写真販売の設定(既存のルールの設定と同じしくみ。操作ログから元に戻せる) | PA-7 |
| GET | /admin/api/system-status | → photoSales | システムの状態に「写真の置き場所(R2)がまだ設定されていません」などを出す | ― |

管理者の変更は、すべて audit_log に残す(target_type: `photo_album`・`photo`・`price_list`・`photo_order`)。

### 6.3 認証なし(/api/photos)

| メソッド | パス | 守り方 | 内容 |
| --- | --- | --- | --- |
| POST | /api/photos/stripe/webhook | Stripe の署名(5分の許容) | Webhook。署名が合わなければ 400 `bad_signature` |
| GET | /api/photos/legal | ― | 特定商取引法に基づく表記・利用規約・プライバシーポリシー(PhotoLegalResponse) |
| GET | /api/photos/files/:token | HMAC の署名・5分 | 代わりの置き場所の1枚の受け取り口。期限切れ・改ざんは 410 `link_expired` |
| GET | /api/photos/files/zip/:token | HMAC の署名・5分 | 代わりの置き場所の ZIP の受け取り口(R2 のときも ZIP は Worker が結合して流す) |

### 6.4 自動処理

| 実行時刻(日本時間) | 処理 | 機能ID |
| --- | --- | --- |
| 毎晩 3:10(既存の夜の処理の最後) | 削除の7日前のお知らせ、販売終了にする、売れなかった写真のファイルを消す、途中でやめたアップロードの片付け(system_jobs に photo_sale_end として残す) | PF-8 |

## 7. 写真の置き場所(apps/api/src/lib/photos/storage.ts)

### 7.1 部品の形

`PhotoStorage` の2つの実装(R2・代わりの置き場所)を同じ形で使う。選ぶのは `photoStorage(env)`: R2 の設定がそろっていれば R2、なければ local・test は代わりの置き場所、本番は null(→ 503「写真の置き場所(R2)がまだ設定されていません」)。

| 操作 | R2 | 代わりの置き場所 |
| --- | --- | --- |
| createMultipart | S3 の CreateMultipartUpload(サーバーから署名して呼ぶ) | 何もしない(null) |
| partTarget | UploadPart の署名つき URL(1時間)。ブラウザから R2 へ直接 PUT | Worker の PUT /admin/api/photos/uploads/:id/parts/:n(x-dr-admin を付ける) |
| listParts | S3 の ListParts | 保存した部分の一覧 |
| completeMultipart / abortMultipart | S3 の CompleteMultipartUpload / AbortMultipartUpload | 目次(部分の並び)を書く / 部分を消す |
| putTarget | PutObject の署名つき URL(Content-Type を署名に入れて固定) | Worker の PUT .../derivatives/:kind |
| get / head / put / delete | R2 のバインディング(PHOTOS) | env.MEDIA(R2 か D1 の media_objects)の `photo-sales/` の下 |
| copy | S3 の CopyObject(サーバーの中でコピー。バイトはそのまま) | 部分ごとにコピーして目次を書く |
| downloadUrl | GetObject の署名つき URL(5分、ファイル名つき) | /api/photos/files/<HMAC の署名>(5分) |
| sha256 | バインディングで読みながら DigestStream で計算 | 部分をつなげて読みながら計算 |

- キーは `<場所>/<ランダムな UUID>/<ランダムな UUID>.<拡張子>`(`newPhotoKey`)。元のファイル名・連番を含めない。場所は originals・purchased・view・preview・thumb。
- 部分の大きさ: R2 は 8MiB(最後以外は 5MiB 以上が必要)、代わりの置き場所は 1.5MiB(D1 の1行 2MB に収める)。

### 7.2 R2(本番)

- 署名は AWS Signature Version 4。`aws4fetch`(MIT ライセンス、Workers で動く小さな署名の部品)を使う。宛先は `https://<アカウントID>.r2.cloudflarestorage.com/<バケット>/<キー>`、region は `auto`。
- 必要な設定: バインディング `PHOTOS`(wrangler.toml)、変数 `R2_ACCOUNT_ID`・`PHOTOS_BUCKET_NAME`、secret `R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY`。どれか1つでも無ければ R2 は使わない。
- バケットは非公開。r2.dev の公開 URL もカスタムドメインも付けない。CORS は管理画面のドメインからの PUT だけ許し、ETag ヘッダーを見せる(マルチパートの完了に要る)。

### 7.3 代わりの置き場所(local・test・デモ)

- 原本は Worker を通して 1.5MiB ずつ送り、env.MEDIA に `photo-sales/<キー>#part-00001` のように保存する。完了すると、キーの場所に目次(Content-Type `application/vnd.dr-chunked+json`)を書く。読むときは部分をつなげてそのまま流す(デコードしない)。
- プレビューなど1回で送るものは、キーの場所にそのまま保存する(目次でないものは、そのまま返す。デモの初期データもこの形)。
- ダウンロードの URL の署名の秘密は `PHOTO_URL_SECRET`(無ければ local・test だけの決まった値)。本番では使わない。

### 7.4 R2 を有効にする手順(20章の未決事項が決まったら)

1. Cloudflare のダッシュボードで R2 を有効にし、`wrangler r2 bucket create dog-run-production-photos`。
2. R2 の「API トークン」で、このバケットだけの「オブジェクトの読み書き」のトークンを作る。GitHub の Secrets に `R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY` を入れる(配信のワークフローが Worker の secret に入れる)。
3. バケットの CORS に、配信先のドメインからの PUT を足す(ExposeHeaders に ETag)。
4. ライフサイクルのルール: originals/・preview/・thumb/ は 200日で削除(自動処理の取りこぼしの保険。purchased/ と view/ には付けない)。
5. wrangler.toml の `[env.production.vars]` の `R2_ACCOUNT_ID`・`PHOTOS_BUCKET_NAME` と、`[[env.production.r2_buckets]]`(binding = "PHOTOS")の # を外して配信する。
6. 管理画面のシステムの状態で「写真の置き場所(R2): 設定済み」になったことを確かめる。

## 8. 決済(Stripe。apps/api/src/lib/photos/stripe.ts)

### 8.1 Checkout

- 購入手続きで、サーバーがカートから注文(orders: pending、order_items)を作り、Stripe の Checkout Session を `POST https://api.stripe.com/v1/checkout/sessions` で作る(fetch。application/x-www-form-urlencoded)。mode = payment、通貨 jpy(小数のない通貨なので金額は円のまま)、明細はカートの ok の行ごとに1つ、metadata.order_id と client_reference_id に注文の番号、送信の印(Idempotency-Key)は注文ごと。
- 支払い方法(カード・Apple Pay・Google Pay・PayPay)は、Stripe のダッシュボードの設定で選ぶ(コードで固定しない)。
- success_url は `/liff/photos/orders/:id`、cancel_url は `/liff/photos/cart`(`photoSuccessUrl`・`photoCancelUrl`)。success_url を開いただけでは確定しない。
- API の版は `Stripe-Version` ヘッダーで固定する(`STRIPE_API_VERSION`。段階1-C が、アカウントを作った時点の版を確かめて合わせる)。

### 8.2 Webhook

- 宛先は `POST /api/photos/stripe/webhook`(LINE のログインなし)。署名は `Stripe-Signature` の `t` と `v1` を、Web Crypto の HMAC-SHA256 で確かめる(`verifyStripeSignature`。本文は受け取ったまま。時刻のずれは5分まで)。
- stripe_event_id を webhook_events に入れてから処理する(同じイベントが何回届いても1回だけ)。
- checkout.session.completed: 注文を paid に → 権利を作る(まるごとは 3.4)→ 原本を購入済み領域へコピーして SHA-256 を確かめる(まだコピーしていない写真だけ)→ カートの行に ordered_at → 購入完了の LINE のお知らせ。金額(amount_total)が注文と違えば確定せず、製作者に知らせる。
- checkout.session.expired: 注文を expired に(カートはそのまま)。
- charge.refunded: 返金した明細の権利を無効に。
- 受け取るイベントは、この3つ(Stripe のダッシュボードで選ぶ)。

### 8.3 まねの Stripe(local・test・デモ)

- `ENVIRONMENT` が local か test で、`STRIPE_MOCK = "1"` のときだけ有効(本番では、値があっても無視する)。LINE ログインのまね(`LINE_LOGIN_MOCK`)と同じ考え方。wrangler.toml の local と、テストの設定と、デモで on。
- Checkout Session を作る代わりに、番号 `cs_mock_<注文の番号>_<ランダム>` を注文に記録し、LIFF のまねの支払いの画面 `/liff/photos/mock-checkout/<番号>` の URL を返す。
- まねの画面の「支払う」は `POST /api/photos/mock-stripe/sessions/:id/pay`。本物と同じ形の checkout.session.completed を作り、本物と同じ方法で署名して(秘密は `STRIPE_WEBHOOK_SECRET`、無ければ local・test だけの決まった値)、本物の Webhook と同じ道(署名の確かめ → 処理)を通す。だから Webhook の処理を、Stripe を呼ばずに通しで確かめられる。
- 返金は、Stripe を呼ばずに成功として返す。
- まねの画面には「練習用の支払いの画面です。お金は動きません」と必ず出す。

### 8.4 Stripe を使い始める手順

1. 施設の名義で Stripe のアカウントを作り、審査を受ける(数日〜1週間。最初に着手する。特定商取引法に基づく表記の URL が要る: 9.3)。
2. ダッシュボードで支払い方法(カード・Apple Pay・Google Pay・PayPay)を有効にする。
3. Webhook の宛先 `https://<配信先>/api/photos/stripe/webhook` を作り、イベント3つ(8.2)を選ぶ。表示された署名の秘密を、GitHub の Secrets の `STRIPE_WEBHOOK_SECRET` に入れる。
4. シークレットキー(制限つきのキーでよい: Checkout Sessions の書き込み、Refunds の書き込み)を `STRIPE_SECRET_KEY` に入れる。
5. 配信し直す(配信のワークフローが Worker の secret に入れる。無ければ「準備中」のまま、ほかの機能は動く)。

## 9. 画面

見た目は `docs/design.md` に従う。色を足さない(主ボタンは墨色。色はリンク・フォーカス・選択中と、意味のある印だけ)。「購入済み」「まるごとに含まれています」「販売が終わりました」の印は灰色で、危険の色にしない。

### 9.1 購入者(LIFF。スマホ)

- 入口は `/liff/photos`。会員登録をしていない LINE ユーザーも開ける(登録の確認より前に分ける)。会員証のメニューへのリンクは、販売を始めたら足す(段階1-B)。
- 販売が準備中なら、どの画面も「写真の販売は準備中です。始まるまで、もうしばらくお待ちください。」(PU-1)。
- 写真は認証つきの API から読み、画面で blob の URL にして出す(誰でも開ける URL にしない)。長押しの保存の抑止は気休めとして入れる(対策の本体ではない)。
- アルバム詳細とビューアでは、写真を複数選んで「カートに入れる」でまとめて入れられる。カートの数はヘッダーの近くに出す。
- アルバムの最初の表示は、4G で2秒以内(サムネイルは遅延読み込み)。

### 9.2 管理画面(PC)

- メニューのいちばん下(「使い方・困ったとき」の上)に「販売」のまとまりを作り、「写真販売」を1つだけ置く(管理者と製作者だけ。1280×800 で「操作ログ」まで見える決まりを崩さないため)。中の画面(PA-1〜PA-7)は上のタブで切り替える(1280×800 で下のメニューが隠れないように)。
- 準備中のときは、タブの下に理由を出す(「写真の置き場所(R2)がまだ設定されていません」など)。
- 言葉は要件定義書 15.1 に従う(「アップロード」「アルバム」「価格表」は管理者がふだん使う言葉として使う。IT 用語を出さない。「削除」ではなく「アルバムから外す」)。

### 9.3 法定表示

- 「特定商取引法に基づく表記」「利用規約(写真販売)」「プライバシーポリシー」を、ログインなしで開けるようにする(Stripe の審査)。中身は設定(photo_tokushoho_text・photo_terms_text・privacy_text)。段階1-C が、Worker から LIFF の外の HTML としても出す。

## 10. データ設計(マイグレーション 0021)

日付は日本時間("2026-11-03")、日時は "2026-11-03T09:00:00+09:00"。残高・金額の残りの列は持たない(権利は entitlements、合計は明細から計算)。

| テーブル | 役割 | 主な項目 |
| --- | --- | --- |
| photo_customers | 購入者(LINE アカウントごと) | LINE ユーザーID(一意)、メール(将来)、表示名、家族ID・おうち(記録だけ)、個人情報を消した日時 |
| price_lists | 価格表 | 名前、1枚の価格、まるごとの価格(任意)、種類ごとの既定(date/event。それぞれ1つ)、状態(使う/使わない)。初期: 通常 500円・イベント 800円 |
| albums | アルバム | 名前、種類、開催日、価格表、状態(下書き/公開中/販売終了)、公開日時、販売終了の日時、カバー写真、もとのフォルダ名、販売終了にした日時、削除の前のお知らせの日時、ファイルを消した日時、一覧から外した日時 |
| photos | 写真(原本1枚 = 1行) | 原本・プレビュー・サムネイル・中サイズ・購入済みのキー、SHA-256、バイト数、形式、幅・高さ、元のファイル名、撮影日時、状態(送っている途中/使える/失敗)、ハッシュを確かめた日時(アップロード後・コピー後)、合わなかった日時、ファイルを消した日時 |
| album_photos | アルバムへの掲載 | アルバム、写真(組で一意)、並び順、状態(下書き/公開中/非公開/外した)、例外価格、公開した日時 |
| photo_uploads | アップロードの途中の記録 | ランダムな ID、写真、アルバム、置き場所、R2 のマルチパートの ID、部分の大きさと数、送り終えたプレビューなど、状態 |
| cart_items | カート(サーバー側) | 購入者、写真1枚/まるごと、アルバム、写真、入れた日時、外した日時、注文に入れた日時と注文。有効な行で、同じ写真は1つ・同じまるごとは1つ(一意の索引) |
| orders | 注文 | 購入者、おうち(記録だけ)、状態(お支払い待ち/済み/返金済み/一部返金/期限切れ/取りやめ)、合計、通貨、本物かまねか、Checkout の番号(一意)、PaymentIntent、送信の印、期限、お支払いの日時、返金した合計 |
| order_items | 明細 | 注文、写真1枚/まるごと、アルバム、写真、価格と名前(注文した時点)、返金の日時・額・Stripe の番号・理由・条件の外か・した人 |
| entitlements | 購入の権利(ダウンロードの唯一の判定元) | 購入者、写真、明細、作った日時、無効にした日時と理由。有効な権利は、同じ人の同じ写真で1つ |
| download_logs | ダウンロードの記録 | 購入者、写真、権利、原本/ZIP、IP のハッシュ、ブラウザ、日時 |
| webhook_events | Webhook の二重処理を防ぐ | Stripe のイベントID(主キー)、種類、状態、エラー、受け取った・処理した日時 |
| photo_notifications | 購入完了の LINE のお知らせ | 注文、購入者、送った/送っていない/送れなかった、理由、文、月 |

設定(settings。packages/shared/src/settings.ts。管理画面から変えられる): photo_sales_enabled(初期 false)、photo_watermark_text(空 = 施設の名前 SAMPLE)、photo_sale_months(6)、photo_deletion_notice_days(7)、photo_download_limit(10回/24時間)、photo_refund_days(7)、photo_notify_purchase(true)、photo_tokushoho_text、photo_terms_text。

管理者の操作ログは既存の audit_log を使う。

## 11. デモ(apps/demo)

- まねの Stripe(STRIPE_MOCK = "1")と、代わりの置き場所で動く。
- 初期データのつなぎ口 `apps/demo/src/seed/photos.ts` の `seedPhotoSales`: ブラウザの canvas で描いた見本の写真(ドッグランの景色と犬の絵。著作物の写真は使わない。`makeSamplePhoto`)で、日付のアルバムとイベントのアルバムを1つずつ、写真6枚ずつ、下書きで作る。販売は止めたまま。
- 段階1の担当が、デモの手順(公開 → カート → まねの支払い → ダウンロード)を足す。

## 12. 不正対策・セキュリティ

方針: ブラウザに出したものは保存できる前提で、「出すものは価値がない(透かし付き・小さい)、原本は正規の購入者にしか渡らない」を守る。公開の前に、実装を見ていない別のエージェントが、この一覧でレビューする(段階2)。

- [ ] 原本のバケットは非公開。公開 URL を付けない。キーはランダムな UUID(連番・元のファイル名を含めない)
- [ ] 原本の URL は、権利を確かめた直後にだけ作る。有効期限5分
- [ ] 画像をその場で変換する口(大きさ・透かしの有無を選べる口)を作らない
- [ ] プレビューは長辺1200px 以下・全面の斜めの透かし・EXIF なし。プレビュー・サムネイルもログインした人にだけ Worker から出す
- [ ] 金額はサーバーが DB から計算する。リクエストの金額・品物の名前は使わない
- [ ] 注文の確定は、署名を確かめた Webhook だけ。success_url では確定しない。stripe_event_id で二重に処理しない
- [ ] 販売終了・非公開・購入済みの写真は、カートに入れるときと購入手続きのときの両方で弾く
- [ ] 返金で権利を無効にする(管理画面からも、charge.refunded からも)
- [ ] 注文・カート・購入した写真・ダウンロードの全 API で、ログイン中の本人のものかを照合する
- [ ] 管理画面の写真販売の API は管理者だけ(受付は 403、製作者は見るだけ)。権限は API で確かめる
- [ ] アップロードの署名つき URL は管理者にだけ作る。キーと Content-Type を固定する
- [ ] 管理画面の変更には x-dr-admin ヘッダー(既存。ほかのサイトからの送信を防ぐ)。ログインのクッキーは HttpOnly・Secure・SameSite=Lax(既存)
- [ ] ダウンロードは写真1枚につき24時間で10回まで。超えたら管理者に知らせる
- [ ] 秘密(Stripe・R2)はコードに書かず、wrangler の secret。まねの Stripe は本番では決して有効にならない
- [ ] 原本は一度もデコード・再エンコードしない。コピーの後に SHA-256 を確かめ、合わなければ知らせる
- [ ] 長押しの保存の抑止は気休め(対策の本体にしない)

## 13. 非機能要件・運用・費用

| 項目 | 要件 |
| --- | --- |
| 想定の規模 | 1日最大300枚・月20日、原本は平均5〜8MB、月約30GB増 |
| 表示の速さ | アルバムの最初の表示が 4G で2秒以内(サムネイルは遅延読み込み) |
| アップロード | 300枚を施設の回線で止めずに送り切れる。同時に4枚。中断しても続きから |
| 対応する端末 | 購入者: iOS Safari・Android Chrome・LINE の中のブラウザ。管理者: PC の Chrome・Edge・Safari |
| バックアップ | D1 の Time Travel と既存の週次のバックアップ。R2 の purchased/ は消さない(Bucket Lock を検討) |
| 監視 | Webhook の失敗、ハッシュの不一致、ダウンロードの上限を超えたことを、システムの状態と PA-1 に出す(メールは 20章) |
| 月額の費用(月50万円売上) | Stripe の手数料 3.6%(18,000円)、R2 は販売中の6か月分(約180GB)で数百円、Workers・D1 は無料枠の見込み(超えたら Workers Paid 月5ドル)。手取り約48.1万円 |

- 代わりの置き場所(D1)は local・test・デモ専用。本番の原本を D1 に入れない(D1 は 500MB まで)。
- 問い合わせ(「ダウンロードできない」「間違えて買った」)は施設が一次対応する。返金の条件は利用規約に書く。

## 14. テスト

- Vitest(packages/shared/test/photos.test.ts): 価格(例外 > 価格表)、まるごとの権利(お支払いの時点で公開中だけ)、返金の条件(7日・未ダウンロード)、販売終了の日(公開 + 6か月、月末)、ダウンロードの上限(24時間で10回)、フォルダの名前、カートの行の状態(まるごとに含まれる・買えない)と重なり、SHA-256。
- Vitest(apps/api/test/p8-photo-*.test.ts・schema.test.ts): 署名つき URL(AWS の公式の例と一致)、R2 の実装(fetch のまね)、代わりの置き場所(部分に分けて送り、つなげるとバイト単位で同じ・コピー・5分の受け取り口)、Webhook の署名(Node で作った値と一致・古い署名・まね)、Stripe の窓口(fetch のまね)、権限(製作者は変更がすべて 403、受付は 403)、準備中の 503、購入者の表、LINE のお知らせの上限の合算、テーブルの制約。
- Playwright(e2e/admin.photos-*・liff.photos-*・contrast-photos*): 段階0は空の画面の見え方・コントラスト・準備中。段階1で各担当が足す。段階2で「アップロード → 購入 → ダウンロード」の SHA-256 の一致。
- 本物の Stripe・R2・LINE はテストで呼ばない。

## 15. 進め方

| 段階 | 作業 | 担当 |
| --- | --- | --- |
| 0. 土台 | この文書、マイグレーション 0021、API の形(zod)、置き場所・Stripe・まねの Stripe・権限の土台、空の画面、デモのつなぎ口 | 統合の担当(1本) |
| 1-A. 管理 | PA-2〜PA-5: 一斉アップロード、プレビューと透かし、価格表、一括操作、公開 | 並行 |
| 1-B. ギャラリー | PU-2〜PU-4(複数選択してカートに入れる) | 並行 |
| 1-C. 決済 | PU-5・PU-6・PA-6: サーバー側のカート、Checkout、Webhook、返金、法定表示 | 並行 |
| 1-D. 配信 | PU-7、5分の URL、ZIP、回数の上限、販売終了の自動処理、PA-1、PA-7 | 並行 |
| 2. 統合 | 統合、通しの e2e(ハッシュの一致)、別のエージェントによるセキュリティのレビュー、直し | 統合の担当 |

段階1の担当ごとのファイルと決まりは `docs/photo-stage1-brief.md`。DB の形・API の形を変えるときは、統合の担当に戻す。

## 20. 未決事項

決まったら、該当する章と設定を直します。値に関わるものは、初期案で作り、管理画面の設定から変えられるようにしてあります。

- [x] 価格表の初期値 → 通常 500円・イベント 800円、まるごとは未設定。日付の既定は通常、イベントの既定はイベント(2026-11-01。仮。PA-5 で変えられる)
- [x] 返金のポリシー → 購入から7日以内で、ダウンロードしていないものだけ。条件の外は管理者が理由を書いて(2026-11-01。設定 photo_refund_days)
- [x] 既存のシステムの技術構成 → 同じ Worker・D1(2026-11-01)
- [x] 購入完了の通知 → LINE のプッシュだけ(予約のお知らせと同じ月の上限)。メールは将来(2026-11-01)
- [x] 家族での購入写真の共有 → しない(2026-11-01)。household_id は記録だけ
- [x] 透かしの文字 → 施設の名前 + SAMPLE(2026-11-01。設定 photo_watermark_text で変えられる)。デザイン(斜めのタイル)は段階1-A の案を依頼主に見せて決める
- [ ] **メールでの購入(ログイン)**: 将来。LINE を使わないお客さんのため。photo_customers.email を使う。マジックリンクにするか、送るサービス(下)と合わせて決める
- [ ] **R2 の有効化**: 依頼主が Cloudflare で R2 を有効にする(無料枠 10GB。超えた分は月 0.015ドル/GB で、月額0円の原則から外れる。6か月で約180GB の見込みなので、費用を依頼主に説明して了承をもらう)。それまで写真販売は「準備中」。手順は 7.4
- [ ] **Stripe のアカウント**: 施設の名義で開設・審査(最初に着手する)。手順は 8.4
- [ ] **特定商取引法に基づく表記の本文**: 販売者の名前(施設の名義)・責任者・所在地・電話番号・メール・販売価格・支払い方法と時期・引き渡しの時期(お支払いの確定後すぐ)・返品(データのため原則不可、7日・未ダウンロードは返金)。施設と確定し、PA-7 で入れる
- [ ] **利用規約・プライバシーポリシー(写真販売の分)**: 個人利用に限る・返品の条件・写真に写る人の扱い。施設と確定する
- [ ] **メールを送るサービス**: メールでの購入・管理者へのお知らせ(削除の7日前・ハッシュの不一致・ダウンロードの上限)に使う。無料で商用利用できるものを選ぶ(Resend など)。決まるまでは、管理画面の表示だけで知らせる
- [ ] 写真に写ったお客さんの扱い(写りたくない人の写真を外す手順。管理画面の「アルバムから外す」で足りるか)
- [ ] フォトレコからの切り替えの日と、お客さんへの案内
- [ ] 開発費と保守の契約の形(定額か、売上連動か)
