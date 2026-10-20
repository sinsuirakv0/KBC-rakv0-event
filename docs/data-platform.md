# データ基盤v2の監視連携

更新日: 2026-10-20。作業ブランチ `codex/data-platform-rebuild`、本番切替前。

`lib/battlecats-monitor.js`の`extractCurrentVersion`はmetadata/jp/current.jsonのschemaVersion=1、status=verified、sourceRegion=jp、版を検証する。旧jp/version.jsonへのfallbackはない。Google Play信号の一致と増加を確認してPublishを起動し、同版の不要な取得を避ける。

`getRepositoryRevision`はmainのGit commitを解決し、`getRepositoryJson`は指定commitのJSON本文を読む。`scripts/monitor-battlecats-site.js`は同じcommitでcurrent、catalog、比較対象のinventoryを照合する。versionCodeで比較対象を選び、件数・size/hashによる差分を作る。サイトのcatalog APIにもrevisionを指定し、必要な両Localデータセットが見える場合に準備完了と判定する。通知リンクもrevision付き。

監視は生成処理と分離したNode.jsのまま。APK・復号鍵を扱わない。データ生成と公開はbattlecats-apkのGitHub Actionsが担当する。

確認: npm run test:battlecats-monitor（27件成功）。通知の外部送信と本番切替は未実施。関連しないイベント取得処理の作業中変更はこのブランチのコミット対象に含めない。

全体状況: https://github.com/sinsuirakv0/battlecats-apk/blob/codex/data-platform-rebuild/docs/data-platform-review.md
