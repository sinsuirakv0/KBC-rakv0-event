# にゃんこ大戦争 Google Play 高速更新監視

## 全体像

この監視は、cron-job.orgからVercel APIを毎分呼び出し、public repositoryのGitHub Actionsを起動します。APIはActionsを起動したらすぐHTTP 200を返します。Google Playへの5秒間隔・60秒間の確認はGitHub Actions側で行うため、cron-job.orgの30秒timeoutには影響されません。

```text
cron-job.org（毎分）
  -> POST /api/trigger-battlecats-monitor（Bearer認証、短時間で応答）
  -> KBC-rakv0-event / monitor-battlecats-google-play.yml
  -> Google Playを5秒間隔・60秒監視
  -> 2つのversion signalが一致し、現在より新しい場合だけ
  -> battlecats-apk / download-battlecats.yml（expected_version付き）
```

Vercel APIは `GH_TOKEN_EVENT` で同じRapid Monitor workflowのrunをdispatch前に確認し、activeなrunがあれば新規dispatchを行わずHTTP 200 `{"status":"already-active"}` を返します。GitHub照会に失敗した場合はdispatchしないfail closedです。public monitor workflowにも同時実行を1本に制限するconcurrencyがあり、API確認と競合した場合の二重防御になります。さらに、publisher dispatch直前にprivate assetsの現在versionとprivate publisherのactive runを再確認します。既存runの対象が判別できない場合もdispatchしません。最終的なversionName・versionCode・署名・hashの検証はprivate publisher側で行います。

## Google Playの検知条件

対象URLは次の固定値です。

```text
https://play.google.com/store/apps/details?id=jp.co.ponos.battlecats&hl=ja&gl=JP
```

以下の2つが同じ `x.y.z` を示す場合だけ候補versionとして採用します。

1. 「新機能」section本文の先頭にある `[x.y.z]`
2. Google Playアプリ詳細の内部structured metadataにあるversionName

どちらかが取得できない、両者が不一致、現在version以下、private APIが失敗、publisher runが既にactive、のいずれかではdispatchしません。HTML全文はログ、artifact、commitへ保存しません。ログへ出すのはHTTP statusと抽出済みversionなどの最小情報だけです。HTTP 403または429では直ちに監視を終了します。一時的な通信障害と5xxにはjitter付きbackoffを適用します。

## GitHub App（第一選択）

GitHub Appを作成し、次のRepository permissionsだけを付与します。

- Contents: Read
- Actions: Write

Installationは `sinsuirakv0/KBC-rakv0-assets` と `sinsuirakv0/battlecats-apk` の選択2repositoryだけに限定します。private keyはダウンロード後、安全な場所で管理してください。

`KBC-rakv0-event` のActions secretsへ次を登録します。

- `MONITOR_APP_ID`: GitHub AppのApp ID
- `MONITOR_APP_PRIVATE_KEY`: PEM形式のprivate key全文

workflowは `actions/create-github-app-token` を固定commit SHAで実行し、installation tokenをjob内だけで生成します。tokenはjob終了時にactionによって取り消されます。

GitHub Appを利用できない場合だけ、fallbackとしてfine-grained PATを `BATTLECATS_PRIVATE_DISPATCH_TOKEN` に登録できます。対象repositoryは同じ2つだけに限定し、Repository permissionsは `KBC-rakv0-assets: Contents read` と `battlecats-apk: Actions write` に必要な範囲だけを設定します。GitHub AppとPATを同時に設定した場合はGitHub Appを優先します。

緊急移行中は、Appと `BATTLECATS_PRIVATE_DISPATCH_TOKEN` のどちらも設定されていない場合に限り、Actions secret `GH_TOKEN_EVENT` を最後のfallbackとして使います。優先順はApp、専用PAT、`GH_TOKEN_EVENT`です。この既存tokenがprivate `KBC-rakv0-assets` のContents readとprivate `battlecats-apk` のActions writeを持つかは、変更をmainへ反映した後の手動runで確認します。秘密値自体はworkflow outputやログへ出しません。専用AppまたはPATの準備後は緊急fallbackへの依存を解消してください。

## Vercel APIの設定

Vercel projectのEnvironment Variablesへ次を登録し、Productionへ再deployします。

- `BATTLECATS_MONITOR_TRIGGER_SECRET`: 32文字以上の暗号学的にランダムな専用secret
- `GH_TOKEN_EVENT`: public `KBC-rakv0-event` の `monitor-battlecats-google-play.yml` をdispatchできるtoken

`BATTLECATS_MONITOR_TRIGGER_SECRET` はGoogle Playやprivate repository用tokenと兼用しません。APIは `Authorization: Bearer <secret>` をSHA-256固定長digestへ変換した後、constant-time比較します。query parameter認証や `force=12` のような固定値は使用しません。

PowerShellでsecretを生成する例です。生成結果をconsole、Issue、workflow logへ貼り付けないでください。

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

## cron-job.orgの設定

[cron-job.org Console](https://console.cron-job.org/)で新しいcron jobを作成します。cron-job.orgの[公式FAQ](https://cron-job.org/en/faq/)では、通常jobの最短間隔は1分、標準timeoutは30秒と説明されています。

- URL: `https://<Vercelのdomain>/api/trigger-battlecats-monitor`
- Schedule: Every minute
- Request method: POST
- Header name: `Authorization`
- Header value: `Bearer <BATTLECATS_MONITOR_TRIGGER_SECRETと同じ値>`
- Request timeout: 30 seconds以内

endpointはactive run照会と必要時のGitHub workflow dispatchだけを行って短くHTTP 200を返します。response本文は新規起動時が `{"status":"dispatched"}`、既存run稼働中が `{"status":"already-active"}` です。401はBearer secret不一致、500はVercel設定不足、502はGitHub照会またはdispatch失敗を示します。

## Actions secrets一覧

`KBC-rakv0-event` repository:

- `MONITOR_APP_ID`
- `MONITOR_APP_PRIVATE_KEY`
- `BATTLECATS_PRIVATE_DISPATCH_TOKEN`（GitHub Appを使えない場合だけ）
- `GH_TOKEN_EVENT`（Appと専用PATがない緊急移行時だけ。private assets read / publisher Actions writeは手動runで要確認）

Vercel project:

- `BATTLECATS_MONITOR_TRIGGER_SECRET`
- `GH_TOKEN_EVENT`

private publisherで必要なGoogle Play認証情報などは `battlecats-apk` 側だけに置き、public repositoryやVercel endpointへ渡しません。

## ローカル検証

```powershell
npm run test:battlecats-monitor
```

実際のGoogle Play HTMLを使う手動確認ではHTML自体を保存せず、抽出した2つのversionだけを確認してください。fixtureはGoogle Playの必要部分だけを縮小してあり、実ページ全文をrepositoryへ含めません。
