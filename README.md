# freee 勤怠データ管理

freeeの「月別データ」から出力したHTML形式の `.xls` を登録し、社員別・月別の登録状況を確認するNext.jsアプリです。UIにはshadcn/ui、DBにはNeon PostgreSQLとDrizzle ORMを使用します。

## セットアップ

1. `.env.local` のダミー値をNeonのConnection stringへ置き換えます。
2. DBテーブルを作成します。
3. localhost限定で開発サーバーを起動します。

```powershell
npm install
npm run db:push
npm run dev -- --hostname 127.0.0.1
```

ブラウザで `http://127.0.0.1:3000` を開きます。

## 主な機能

- `.xls` 内の表示期間と日付範囲から対象年月を判定
- フルネームをブラウザ内で社員コード・苗字へ変換し、名を破棄
- 休暇の「日」と「時間」を別々に保存
- 新入社員、不足社員、苗字変更、同月置換の事前確認
- 社員×12か月の登録状況、月次明細、社員マスタの表示・編集

## 個人情報に関する制約

初期版にはログイン制限がありません。開発サーバーは必ず `127.0.0.1` へバインドし、認証を追加するまで外部公開しないでください。元ファイル、社員の名、フルネームはサーバーやDBへ保存しません。

## 検証

```powershell
npm test
npm run lint
npm run build
```
