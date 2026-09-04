# Business-Days-Schedule

営業日を考慮したカレンダー。

日本の祝日を自動で取り込み、**反復ルール**（毎月25日／月末営業日／第5営業日／第2・第4火曜 など）から
予定を導出し、休祝日にかかった予定を**前営業日・翌営業日へ自動でずらして**表示します。

ルールを持たない単発の予定登録は、意図的に対象外としています。

- 📄 **[仕様書 docs/SPEC.md](docs/SPEC.md)**

## 状態

**M1 完了** — ロジック層と祝日データ更新の基盤。カレンダー UI は M2 以降。

| | |
|---|---|
| ロジック層 | `src/core/` — 営業日判定・反復ルール展開・営業日補正・検証・入出力 |
| テスト | 144 件（`npm test`）。§6 の実務ユースケース16件を回帰テスト化 |
| 祝日データ | `public/data/holidays.json`（毎週月曜 03:00 JST に自動更新） |

## 祝日データについて

一次ソースは [`holiday-jp/holiday_jp`](https://github.com/holiday-jp/holiday_jp) の `holidays.yml`
（UTF-8、1970〜2050年、振替休日・国民の休日を収録）。
内閣府 CSV は Shift_JIS・掲載範囲が翌年までと扱いにくいため、CI 上での二次検証にのみ使い、
差異を検出した場合は Issue を自動起票します。詳細は [仕様書 §3](docs/SPEC.md#3-祝日データ)。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm test           # テスト
npm run typecheck  # 型チェック
npm run build      # 本番ビルド
```

祝日データの手動更新:

```bash
npm run holidays         # holidays.yml → public/data/holidays.json
npm run holidays:verify  # 内閣府 CSV と直近3年分を突合
```
