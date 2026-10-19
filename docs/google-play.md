# Google Play で公開する（TWA）

my-money は PWA なので、**TWA（Trusted Web Activity）** という仕組みで包むと、今の `public/` をそのまま Android アプリとして Google Play に出せる。アプリの中身は GitHub Pages から読み込むので、Web 版を更新すればアプリ側も更新される（ストアへの再提出が必要なのは、アイコンや名前など Android 側の設定を変えたときだけ）。

- パッケージ名：`io.github.gangidenset.mymoney`（**公開後は変更できない**）
- 配信 URL：`https://gangidenset.github.io/my-money/`

---

## 0. 先に解決すること：assetlinks.json の置き場所

TWA は「このアプリとこのサイトは同じ持ち主」という証明（Digital Asset Links）を、**ドメインの直下**の
`https://gangidenset.github.io/.well-known/assetlinks.json` から読む。
証明がないと、アプリの上部にブラウザのアドレスバーが出たままになる（審査で指摘されやすい）。

今の配信先は `/my-money/` の下なので、このリポジトリからは置けない。次のどちらかにする。

### A. ユーザーサイトのリポジトリを作る（無料・おすすめ）

1. GitHub で `gangidenset.github.io` という名前の公開リポジトリを作る
2. 次の2つのファイルを追加する
   - `.well-known/assetlinks.json`（中身は [twa/assetlinks.json](../twa/assetlinks.json) を、手順4の SHA-256 に書き換えたもの）
   - `.nojekyll`（空のファイル。これがないと `.well-known` フォルダが公開されない）
3. Settings → Pages で main ブランチから公開する
4. `https://gangidenset.github.io/.well-known/assetlinks.json` を開いて、中身が表示されることを確認する

`gangidenset.github.io/my-money/` の配信はそのまま変わらない。

### B. 独自ドメインを使う

`mymoney.example.jp` のような独自ドメインを取り、GitHub Pages に設定する（年1,000〜3,000円ほど）。
その場合は配信 URL が変わるので、`public/` に `.well-known/assetlinks.json` を置き、`service-worker.js` の `SHELL` に入れない扱いをテストで除外する。ドメインを変えると Web 版の保存データは引き継がれない（ブラウザのデータはドメインごと）ので、利用者がいるなら A のほうが安全。

---

## 1. 必要なもの

- **Google Play Console のデベロッパーアカウント**（登録料 25 ドル・1回のみ）。本人確認があり、数日かかることがある
- **Node.js**（入っている）
- **JDK 17 と Android SDK**：bubblewrap が初回に「自動でダウンロードするか」を聞くので、Yes でよい

> 個人アカウントで新しく作った場合、本番公開の前に **クローズドテスト（12人以上が14日間続けて参加）** が必要。
> 家族や友人にテスターをお願いしておく。条件は変わることがあるので、Play Console の表示を確認する。

## 2. bubblewrap で Android プロジェクトを作る

鍵や生成物をリポジトリに入れないよう、**このリポジトリの外**に作業フォルダを作る。

```bash
npm install -g @bubblewrap/cli
mkdir my-money-android
cd my-money-android
bubblewrap init --manifest=https://gangidenset.github.io/my-money/manifest.json
```

質問への答え：

| 質問 | 答え |
|---|---|
| Domain | `gangidenset.github.io` |
| URL path | `/my-money/#/home` |
| Application name | `my-money 家計シミュレーション` |
| Short name | `my-money` |
| Application ID（パッケージ名） | `io.github.gangidenset.mymoney` |
| Display mode | `standalone` |
| Orientation | `portrait` |
| Status bar color | `#0f766e` |
| Splash screen color | `#f4f6f5` |
| Icon URL | `https://gangidenset.github.io/my-money/icons/icon-512.png` |
| Maskable icon URL | `https://gangidenset.github.io/my-money/icons/icon-maskable-512.png` |
| Monochrome icon | なし（Enter） |
| Include support for Play Billing | **No**（有料プランを作るときに追加する） |
| Request geolocation permission | **No** |
| Key store location / alias | 既定のまま（`android.keystore` / `android`） |

鍵のパスワードを2回聞かれる。**鍵ファイル（android.keystore）とパスワードは絶対になくさない**こと。なくすとアプリを更新できなくなる。パスワード管理アプリに保存し、鍵ファイルはクラウドにもコピーしておく（リポジトリには入れない）。

## 3. ビルドする

```bash
bubblewrap build
```

`app-release-bundle.aab`（ストアに出すファイル）と `app-release-signed.apk`（手元の端末で試すファイル）ができる。
APK を Android 端末に入れて起動し、表示と保存ができるか確認する。

## 4. assetlinks.json を仕上げる

SHA-256 を2つ集める。

1. **アップロード鍵**：`bubblewrap fingerprint list`（または `keytool -list -v -keystore android.keystore` の SHA256）
2. **アプリの署名鍵**：Play Console でアプリを作って AAB を上げたあと、「テストとリリース → 設定 → アプリの完全性 → アプリの署名」に出る SHA-256

2つを `assetlinks.json` に入れて、手順0の場所に置く。反映後にアプリを入れ直すと、アドレスバーが消える。

## 5. Play Console に登録する

1. 「アプリを作成」：アプリ名 `my-money`、既定の言語 日本語、無料
2. ストアの掲載情報
   - 短い説明（80文字以内）：例「給料日までに、あといくら使えるかすぐ分かる家計アプリ。データは端末の中だけ」
   - 詳しい説明・アイコン（512×512：`public/icons/icon-512.png`）・フィーチャーグラフィック（1024×500）・スマホのスクリーンショット（2枚以上）
3. アプリのコンテンツ
   - **プライバシーポリシー**：`https://gangidenset.github.io/my-money/privacy.html`
   - **データ セーフティ**：「ユーザーデータを収集または共有しない」を選ぶ（データは端末内だけ・外部送信なしのため）
   - **広告**：含まない
   - **対象年齢**：18歳以上などを選ぶ（家計アプリのため）
   - **金融機能の申告**：「個人の資産管理・予算管理」を選ぶ。ローンや投資の売買機能はない
   - コンテンツのレーティング：アンケートに答える
4. クローズドテスト → 条件を満たしたら本番公開を申請

---

## 更新するとき

- **Web 版の変更**（画面・機能）：今までどおり main に push するだけ。アプリにも反映される
- **Android 側の変更**（アイコン・名前・Play Billing の追加など）：`twa-manifest.json` を直し、`appVersionCode` を1つ上げて `bubblewrap update` → `bubblewrap build` → AAB を Play Console に上げる

## 公開前のチェック

- [ ] `gangidenset.github.io/.well-known/assetlinks.json` が開ける
- [ ] プライバシーポリシー・利用規約が HTTPS で開ける
- [ ] APK を実機に入れて、アドレスバーが出ない・オフラインで起動できる
- [ ] 鍵ファイルとパスワードを2か所以上に保管した
