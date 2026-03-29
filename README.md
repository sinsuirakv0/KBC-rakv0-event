# KBC-rakv0-event

にゃんこ大戦争のイベントデータ（ガチャ・セール・アイテム）を定期取得し、JSONに変換してこのリポジトリに保存するバックエンドです。

フロントエンド（[kbc-rakv0-test](https://github.com/sinsuirakv0/KBC-rakv0-test/blob/main/main/event.html)）は `data/` フォルダのJSONを読み込んで表示します。

このリポジトリにあるコード、そしてREADME.mdはすべてclaudeにより生成されています。

---

## 全体の仕組み

```
【定期実行】
cron-job.org
  └─ GitHub API を叩く (POST /dispatches)
       └─ .github/workflows/check-events.yml が起動
            └─ node scripts/run.js を実行
                 ├─ lib/jwt.js        : ゲームサーバーへの認証トークンを取得
                 ├─ scripts/fetch-tsv.js : TSVを取得・MD5で変更確認
                 └─ scripts/update-files.js : 変更があれば保存
                      ├─ raw/         : TSVをそのまま保存（履歴）
                      ├─ data/        : JSONに変換して保存（フロントが読む）
                      └─ hashes/      : 次回比較用のMD5を保存

【強制更新】
ブラウザで URL を開く
  └─ kbc-rakv0-event.vercel.app/api/force-update?force=12
       └─ api/force-update.js が GitHub API を叩く
            └─ check-events.yml が --force オプション付きで起動
                 └─ node scripts/run.js --force
                      └─ 変更の有無に関わらず data/ を削除→再生成
```

---

## ディレクトリ構成

```
KBC-rakv0-event/
│
├─ .github/
│   └─ workflows/
│       └─ check-events.yml   # GitHub Actions ワークフロー
│
├─ api/
│   └─ force-update.js        # Vercel APIエンドポイント（強制更新用）
│
├─ lib/
│   ├─ github.js              # GitHub APIラッパー
│   ├─ jwt.js                 # ゲームサーバー認証
│   └─ timestamp.js           # JSTタイムスタンプ生成
│
├─ parsers/
│   ├─ gatya.js               # ガチャTSV → JSON変換
│   ├─ sale.js                # セールTSV → JSON変換
│   └─ item.js                # アイテムTSV → JSON変換
│
├─ scripts/
│   ├─ run.js                 # メインエントリポイント
│   ├─ fetch-tsv.js           # TSV取得・変更チェック
│   └─ update-files.js        # ファイル保存処理
│
├─ data/
│   ├─ gatya.json             # 変換済みガチャデータ（フロントが読む）
│   ├─ sale.json              # 変換済みセールデータ（フロントが読む）
│   └─ item.json              # 変換済みアイテムデータ（フロントが読む）
│
├─ hashes/
│   ├─ gatya.md5              # 前回取得したgatya.tsvのMD5ハッシュ
│   ├─ sale.md5               # 前回取得したsale.tsvのMD5ハッシュ
│   └─ item.md5               # 前回取得したitem.tsvのMD5ハッシュ
│
├─ raw/
│   ├─ gatya_1774421291.tsv   # 変更があったときのTSV生データ（履歴）
│   └─ ...                    # ファイル名はユニックス時間
│
└─ package.json
```

---

## 各ファイルの詳細

---

### `.github/workflows/check-events.yml`

**役割**: cron-job.org から呼ばれて `scripts/run.js` を実行するワークフロー。

**起動方法が2種類ある:**

| 種類 | 起動元 | 動作 |
|------|--------|------|
| 通常実行 | cron-job.org | `node scripts/run.js` |
| 強制更新 | `api/force-update.js` | `node scripts/run.js --force [対象ファイル]` |

**`inputs.force` の値:**
- 空文字 → 通常実行（変更があったファイルのみ更新）
- `"gatya sale item"` → 全ファイルを強制更新
- `"gatya"` → gatyaのみ強制更新

**必要なSecret:**
- `GH_TOKEN_EVENT`: GitHub Personal Access Token（`repo` + `workflow` スコープ）

---

### `api/force-update.js`

**役割**: ブラウザからURLを叩くことで強制更新を起動するVercel APIエンドポイント。

**URL:**
```
https://kbc-rakv0-event.vercel.app/api/force-update?force=12
```

**オプション:**
```
# 全ファイルを強制更新
?force=12

# 特定ファイルのみ強制更新
?force=12&types=gatya
?force=12&types=gatya,sale
```

**認証:** `?force=12` のクエリパラメータが一致しない場合は `403 Forbidden` を返す。

**仕組み:**
1. GitHub API の `workflow_dispatch` エンドポイントを POST で叩く
2. `inputs.force` に対象ファイル名を渡す
3. `check-events.yml` が `--force` オプション付きで起動する

**必要な環境変数（Vercel）:**
- `GH_TOKEN_EVENT`: GitHub Personal Access Token

---

### `lib/github.js`

**役割**: GitHub Contents API のラッパー。ファイルの読み取り・書き込み・削除をまとめた関数群。

**関数一覧:**

```js
// ファイルを取得する
// 戻り値: { content: string, sha: string } | null
getGitHubFile(path)

// ファイルを作成または上書きする
// shaがなければ新規作成、あれば上書き
updateGitHubFile({ path, content, message })

// ファイルを削除する
deleteGitHubFile({ path, message })
```

**定数:**
```js
GITHUB_OWNER  = "sinsuirakv0"
GITHUB_REPO   = "KBC-rakv0-event"
GITHUB_BRANCH = "main"
GITHUB_TOKEN  = process.env.GH_TOKEN_EVENT  // 環境変数から読む
```

---

### `lib/jwt.js`

**役割**: にゃんこ大戦争のゲームサーバーにアクセスするための認証トークン（JWT）を取得する。

**流れ:**
```
getJWT()
  └─ getInquiryCode()  : 仮アカウントのIDを発行してもらう
  └─ getPassword()     : そのIDでパスワードを取得する
  └─ getToken()        : ID＋パスワードでJWTを取得する
```

取得したJWTをTSVのURLに付けることで、ゲームサーバーからデータを取得できる。

```
https://nyanko-events.ponosgames.com/battlecats_production/gatya.tsv?jwt={JWT}
```

---

### `lib/timestamp.js`

**役割**: JST（日本標準時）のタイムスタンプ文字列を生成する関数を提供する。

複数のファイルで同じ処理を書かないよう、ここに集約している。

**出力形式:**
```
"26/03/11 12:05:00"  （YY/MM/DD HH:MM:SS）
```

この値が `data/*.json` の先頭に `updatedAt` として記録される。

---

### `parsers/gatya.js`

**役割**: ガチャのTSVデータをJSONに変換する。

**入力:** ゲームサーバーから取得したTSV（タブ区切りテキスト）

**出力例:**
```json
[
  {
    "header": {
      "startDate": "20260216",
      "startTime": "1100",
      "endDate": "20260302",
      "endTime": "1100",
      "minVersion": "150101",
      "maxVersion": "999999",
      "gachaType": 1,
      "gachaCount": 2
    },
    "gachas": [
      {
        "id": 785,
        "price": 150,
        "flags": 20600,
        "rates": {
          "normal": 0,
          "rare": 7000,
          "superRare": 2500,
          "uberRare": 500,
          "legendRare": 0
        },
        "guaranteed": false,
        "message": "バレンタイン期間限定のスイートなガチャ！"
      }
    ]
  }
]
```

---

### `parsers/sale.js`

**役割**: セール（イベントステージ）のTSVデータをJSONに変換する。

**出力例:**
```json
[
  {
    "header": { ... },
    "timeBlocks": [
      {
        "dateRanges": [],
        "monthDays": [],
        "weekdays": ["Mon", "Wed", "Fri"],
        "timeRanges": [["1100", "1300"]]
      }
    ],
    "stageIds": [1028, 1059]
  }
]
```

`timeBlocks` はそのステージが開催される曜日・日付・時間帯の条件を表す。

---

### `parsers/item.js`

**役割**: アイテム（ログインボーナス・プレゼント）のTSVデータをJSONに変換する。

**出力例:**
```json
[
  {
    "header": { ... },
    "timeBlocks": [ ... ],
    "gift": {
      "eventId": 51677,
      "giftType": 35018,
      "giftAmount": 0,
      "title": "にゃんこ強化週間！",
      "message": "ログインでネコカン280個ゲット！",
      "url": "",
      "repeatFlag": 1
    }
  }
]
```

---

### `scripts/run.js`

**役割**: 処理全体の司令塔。引数を解析して `fetchAndCheck` と `updateFiles` を順番に呼ぶ。

**実行方法:**
```bash
# 通常実行（変更があったファイルのみ更新）
node scripts/run.js

# 全ファイルを強制更新
node scripts/run.js --force

# gatyaのみ強制更新
node scripts/run.js --force gatya

# 複数指定
node scripts/run.js --force gatya sale
```

**処理の流れ:**
```
1. 引数を解析（--force / 対象ファイル名）
2. JWTを取得
3. 対象ファイル（gatya / sale / item）をループ
   3-1. fetchAndCheck() でTSVを取得・変更確認
   3-2. 変更なし かつ --force でなければスキップ
   3-3. updateFiles() でファイルを保存
```

---

### `scripts/fetch-tsv.js`

**役割**: ゲームサーバーからTSVを取得し、前回のMD5ハッシュと比較して変更があるか判定する。

**戻り値:**
```js
{
  changed: true,           // 変更があったか
  text: "...(TSVの中身)", // 取得したTSVテキスト
  hash: "abc123...",      // 今回のMD5ハッシュ
  error: null             // エラーがあれば文字列
}
```

**MD5比較の仕組み:**
1. ゲームサーバーからTSVを取得
2. そのTSVのMD5ハッシュを計算
3. `hashes/{name}.md5` に保存されている前回のハッシュと比較
4. 違えば `changed: true`、同じなら `changed: false`

---

### `scripts/update-files.js`

**役割**: 変更があったTSVをリポジトリに保存し、JSONに変換して保存する。

**処理の順序:**

```
1. TSVを raw/{name}_{ユニックス時間}.tsv に保存（履歴として残す）
2. --force の場合は data/{name}.json を削除
3. TSVをJSONに変換して data/{name}.json に保存
      ↓ 保存形式
   { "updatedAt": "26/03/11 12:05:00", "data": [...] }
4. MD5ハッシュを hashes/{name}.md5 に保存
```

---

### `data/*.json`

**役割**: フロントエンド（event.html）が fetch で読み込む静的JSONファイル。

**保存形式:**
```json
{
  "updatedAt": "26/03/11 12:05:00",
  "data": [
    { ... },
    { ... }
  ]
}
```

- `updatedAt`: このJSONが生成された日時（JST）
- `data`: parsersが変換したデータ配列

フロントエンドは `updatedAt` を「前回の更新時間」表示に使い、`data` をイベント一覧の表示に使う。

---

### `hashes/*.md5`

**役割**: 前回取得したTSVのMD5ハッシュを保存しておくファイル。

次回実行時に今回のTSVのハッシュと比較することで、データに変更があったかどうかを判定する。変更がなければ無駄なGitHubへの書き込みを省略できる。

```
hashes/gatya.md5  →  f45e94af7e422ffd62e1eccc4fa3d041
hashes/sale.md5   →  e7bc954c007113304608dda03acaa60d
hashes/item.md5   →  184fedfe081b0f63e3bd31ee2bc9d93b
```

---

### `raw/*.tsv`

**役割**: 変更があったときのTSV生データを履歴として保存するフォルダ。

ファイル名にユニックス時間（秒）を付けることで、いつのデータかが追跡できる。

```
raw/gatya_1774421291.tsv  →  2026年3月25日のgatya.tsv
raw/sale_1774421292.tsv   →  同日のsale.tsv
```

変更がなかったときは保存されない。更新頻度が数週間に1回程度なので、ファイル数は増えすぎない。

---

## 環境変数

### GitHub Actions（Secrets）
| 変数名 | 説明 |
|--------|------|
| `GH_TOKEN_EVENT` | GitHub Personal Access Token（`repo` + `workflow` スコープ必須） |

### Vercel（Environment Variables）
| 変数名 | 説明 |
|--------|------|
| `GH_TOKEN_EVENT` | 同上（`api/force-update.js` が GitHub API を叩くために使う） |

---

## cron-job.org の設定

| 項目 | 値 |
|------|----|
| URL | `https://api.github.com/repos/sinsuirakv0/KBC-rakv0-event/actions/workflows/check-events.yml/dispatches` |
| Method | POST |
| Header: Authorization | `token {GitHub PAT}` |
| Header: Content-Type | `application/json` |
| Header: Accept | `application/vnd.github+json` |
| Body | `{"ref": "main", "inputs": {"force": ""}}` |

---

## npm scripts

```bash
npm start          # 通常実行
npm run force      # 全ファイル強制更新
npm run force:gatya  # gatyaのみ強制更新
npm run force:sale   # saleのみ強制更新
npm run force:item   # itemのみ強制更新
```
