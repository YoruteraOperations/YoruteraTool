# YoruteraTool v2.0.0

Minecraft 統合版（Bedrock）向けの、サーバーメンバー用ツールサイトです。
公開URL：https://yoruteraoperations.github.io/YoruteraTool/

ブラウザで開くだけで動きます（サーバー不要・ビルド不要）。

## ページ一覧

| ページ | ファイル | 内容 |
|---|---|---|
| トップ | `index.html` | 各ツールへのリンク |
| テキストエディタ | `toolPages/texteditor.html` | ゲーム内テキスト（§）生成 |
| ピクセルエディタ16x16 | `toolPages/pixelEditor.html` | 16×16 アイテムテクスチャ |
| ピクセルエディタ64x32 | `toolPages/pixelEditorArmor.html` | 防具を着たときの見た目用テクスチャ |
| ピクセルエディタ64x64 | `toolPages/pixelEditorSkin.html` | プレイヤースキン |
| 円ジェネレーター | `toolPages/circleGenerator.html` | 円・楕円のブロック配置計算 |
| アイテムID検索（バニラ） | `toolPages/searchItemID.html` | 統合版バニラのID検索（v26.50対応） |
| アイテムID検索（アドオン） | `toolPages/searchAddonItemID.html` | 自作アドオンのID検索 |
| バイオームID検索 | `toolPages/searchBiomeID.html` | /locate biome 用 |
| NPC用コマンド生成 | `toolPages/convertItemCommand.html` | アイテム交換・換金用 |

## アイテムID検索（バニラ）

- データはページ内の `var ITEMS=[{id,name}, ...]` に直接書かれています。ID に `minecraft:` は付けません。
- **アイテム名・IDのどちらでも部分一致で検索できます。** IDは大文字・小文字を区別せず、先頭に `minecraft:` が付いていても検索できます（表示するIDには付けません）。
- 更新するときは、既存のデータを消さずに**配列の末尾へ追記**します（NPCスポーンエッグなど通常の一覧に出ないIDも登録済みのため）。
- v26.50 対応の追加分は、Mojang 公式の [bedrock-samples](https://github.com/Mojang/bedrock-samples)（タグ `v1.26.50.4`）の `metadata/vanilladata_modules/mojang-items.json`（統合版のIDの一覧）と `resource_pack/texts/ja_JP.lang`（公式の日本語名）から取っています。
- アイコンは minecraft.wiki の画像を外部から読み込んでいます（画像が無いものは空欄になります）。

## アイテムID検索（アドオン）

`_build/` のスクリプトで生成しています。手で直接編集しないでください。

| ファイル | 役割 |
|---|---|
| `addonItems.csv` | 元データ（365blocks など） |
| `_build/extra_items.py` → `extra_items.json` | CSV外の自作アイテム（mdrSticks・login_bonus）。※スクリプト内の参照パスは旧配置のまま |
| `_build/extra_items_2.py` → `extra_items_2.json` | 宝砂・yoruteraItems・customArmors（`mcdata` 配下のアドオンを読み取り専用で参照） |
| `_build/render_icons.py` | アイコン画像（`_build/icons/`）の生成 |
| `_build/build_page.py` | 上記をまとめて `toolPages/searchAddonItemID.html` を生成 |

再生成の手順：

```
cd _build
python extra_items_2.py   （宝砂・yoruteraItems・customArmors を更新したときだけ）
python build_page.py
```

- 同じIDが複数のデータにある場合は先に読んだ方を使います（重複は `page_report.json` の `dup` に記録）。
- 宝砂（`yorutera:treasure_sand`）はバニラの砂テクスチャを使っているため、アイコンは minecraft.wiki の砂の画像（外部）を表示します。

## ピクセルエディタ

### ピクセルエディタ16（`pixelEditor.html`）
- 単独ファイルです（共通ファイルは使いません）。
- ツール：ペン、消しゴム、スポイト、直線、四角、円、ひし形、塗りつぶし。元に戻す／やり直し、PNGの読み込み・書き出し（16×16）。

### ピクセルエディタ 装備／スキン（`pixelEditorArmor.html` / `pixelEditorSkin.html`）
- 描画処理は共通ファイル `toolPages/pixelEditorCore.js` と `toolPages/pixelEditorCore.css` にまとめてあります。**修正はこの2つに行えば、装備・スキンの両方に反映されます**（ピクセルエディタ16には反映されません）。
- 各ページはサイズ・下敷き・サンプルの設定だけを持っています。
- 機能：16版と同じツール一式＋拡大縮小（＋／－／全体表示、Ctrl＋ホイール）、表示の移動（✋移動）、下敷きのON/OFF・種類切り替え、サンプル読み込み、PNG読み込み（同じサイズはそのまま／中央クロップ／全体を収める／左上に原寸）、実寸での書き出し。
- 下敷きは別のキャンバスに描いた表示専用の重ね絵です。画素データ・塗りつぶし・書き出しには一切影響しません。

#### 下敷きの配置（Mojang 公式のジオメトリ定義と一致させています）
- 装備 64×32（`geometry.player.armor.base`）：頭(0,0) 頭の外側(32,0) 胴(16,16) 腕(40,16) 脚(0,16)。
  - `〜_1.png`：ヘルメット（頭）、チェストプレート（胴・腕）、ブーツ（脚）
  - `〜_2.png`：レギンス（胴＝腰回り・脚）
- スキン 64×64（`geometry.humanoid.custom` / `customSlim`）：
  - 1層目：頭(0,0) 胴(16,16) 右腕(40,16) 左腕(32,48) 右脚(0,16) 左脚(16,48)
  - 2層目：頭(32,0) 胴(16,32) 右腕(40,32) 左腕(48,48) 右脚(0,32) 左脚(0,48)
  - 腕の幅は標準＝4px、細い腕＝3px。

#### サンプル
- 下敷きと同じ配置を部位ごとに色分けして塗った自作の下絵です（バニラのテクスチャ・スキンは使っていません）。
- 描きかけの内容がある状態で読み込むと確認が出ます（読み込み後も「元に戻す」で戻せます）。

### 塗りつぶしの仕様（全エディタ共通）
- クリックしたマスと同じ色でつながっている範囲を、選択中の色で塗ります。つながりは上下左右の4マスで判定します（斜めはつながりに含めません）。
- 透明も1つの色として扱うので、透明の部分も塗れます。
- 1回の塗りつぶしは「元に戻す」1回で戻せます。
- 縦横の線だけでなく、ひし形・円・斜めの線（1マス幅）で閉じた枠も、外へはみ出さずに内側だけを塗れます。
- 斜めにだけ接している同じ色のマスは、別の範囲として扱います（一緒には塗られません）。

## デバッグ・確認方法

- ローカルで確認するときは、このフォルダで `python -m http.server 8765` を実行し、`http://localhost:8765/` を開きます（ファイルを直接開いても動きます）。
- 表示がおかしいときは、ブラウザの開発者ツール（F12）の Console にエラーが出ていないか確認してください。
- アドオン検索の再生成後は `_build/page_report.json` で件数・アイコン無し・重複を確認します。

## バックアップ

- `_backup/before_v26_50_update/`：2026-10-03 の更新前の一式（index.html、common.css、toolPages、addonItems.csv、_build のスクリプト類）
- `_backup/before_group_layout/`、`_backup/index_before_circle.html`：それ以前の退避分

## 更新履歴

### 2026-10-03
1. バニラのアイテムID検索に、統合版 v26.50 までの未登録アイテム61件を追加（既存2,710件は変更なし → 計2,771件）。トップの表記を「v26.50対応」に変更。
2. アドオンのアイテムID検索に、宝砂1件・yoruteraItems 3件・customArmors 21件を追加（283件 → 308件）。
3. バニラのアイテムID検索で、IDからの検索（部分一致・`minecraft:` 付きも可）に対応。
4. ピクセルエディタ16：「図形の中を塗る」を廃止し、「塗りつぶし」ツールを追加。
5. ピクセルエディタ 装備 64×32／スキン 64×64 を新規追加（下敷き・サンプル付き）。

### 2026-10-03（修正）
- 塗りつぶしのつながり判定を「周囲8マス」から「上下左右の4マス」に変更（ピクセルエディタ16・装備・スキンすべて）。ひし形・円・斜めの線で囲んだ内側からはみ出さないようにした。
- トップの作成ツールの並びを「ピクセルエディタ16x16 → 64x32 → 64x64 → テキストエディタ → 円ジェネレーター」に変更。
