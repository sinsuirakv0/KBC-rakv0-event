# skd通知と重複防止

2026-09-10。今回の変更対象はgatya / sale / itemの通知経路。ad・noticeの追加は含めない。

## 確認した原因

以前の改善はmainへpushされておらず、Check Eventsは約1分ごとのdispatchに対して85秒間監視し、重複実行を許していた。旧runRoundは速報送信後にupdateTypeで保存済みハッシュを再確認していたため、保存だけ省略しても速報は既に重複する。rawの1788844575と1788844576の3種はそれぞれ同一内容だった。

## 現在の処理

- .github/workflows/check-events.ymlはconcurrency=check-events-main、cancel-in-progress=false。実行中を打ち切らず、待機後はmainの最新内容をcheckoutする。通常の待機枠は最新1件とし、古い定期チェックを蓄積させない。
- run.jsのcheckAndNotifyは各TSV取得完了後、保存済みハッシュをリモートで再確認してから通知する。確認に失敗した場合は速報を送らない。他のTSVの取得完了を待たず種類を通知できる。
- lib/skd-notifications.jsのcreateSkdNotifier.detectは通知ID、最初の検知時刻、更新前commitと対象ハッシュをstate/skd-notifications.jsonへ保存してからBotへtypesを送る。同時実行で競合してもSHAを読み直し、既存pendingのIDを使う。
- updateFiles完了後、savedがrawパスをpendingに保存する。全種類の確認後、finishが更新後commitを固定してreadyを送る。Botは更新前commitの種類別の最新raw TSVと、今回保存したTSVを同じパーサーで解析し、追加通知を行う。
- 配送失敗時はpendingを残す。次のrunは同じ通知IDとsnapshotで再試行する。raw保存記録が欠けた種類は、次回TSVを再取得・保存して復旧する。
- 成功時はlastHashesを更新しpendingを解除する。同じハッシュの再通知を省くが、その後別の更新を挟んで元の内容に戻った場合は新しい通知IDを発行する。
- 409で送信結果不明となった場合はheldに記録を残し、同じ更新を自動で再投稿しない。他の新しい更新は監視を継続する。heldは運用者がBot側の投稿を確認してから手動解決する。自動削除はない。

GitHub状態更新は専用キューとSHAで競合を検出し、古いJSONを新しいSHAで無条件に上書きしない。既存の通常更新・LINE通知・管理Webhookは維持する。--forceはJSONの再生成を行うが、同じ完了済みskdを再通知しない。

## 通信・運用

BotのURLと認証は既存BOT_EVENT_UPDATE_URL / BOT_EVENT_UPDATE_SECRETを使用する。旧notifyEventBotはLINEの経路を担当し、Discordへの新しい通知はsendSkdEventに分離する。Botへの応答待ちは通常30秒、readyは120秒。最大3回、同じIDで再試行する。待機・送信中の強制終了でもpendingを捨てない。

通常起動で過去全件を再通知しない。--test-detectは専用IDの検知試験だけを送り、状態・原本を保存しない。外部監視のdispatch先は引き続きcheck-events.yml / main。

2026-09-11、種類別に時系列で連続し、Git blobが完全一致した重複rawを8ファイル削除した。各組の新しい時刻を残した。内訳はgatya 2件（1786080495→1786080499、1788844575→1788844576）、sale 3件（1786080495→1786080499、1787894064→1787894066、1788844575→1788844576）、item 3件（1777273942→1777347491、1787894064→1787894066、1788844575→1788844576）。異なる内容を挟んだ履歴は削除せず、過去commitも書き換えない。

検証: npm run test:skd、node --check scripts/run.js、git diff --check。Bot側のテストでは4分類・各5件・順序・KBCリンク・重複受信・再起動復元を確認する。

参照: [GitHub concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)、[checkout ref](https://github.com/actions/checkout)。
