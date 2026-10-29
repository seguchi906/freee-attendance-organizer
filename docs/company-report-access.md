# company-reportの業務API制限とOPTIONS

検証済みアクセストークンの `azp` がcompany-report（`20156efa-58be-4865-942c-6cd876a5488b`）、かつ `oid` がサーバー環境変数 `COMPANY_REPORT_ALLOWED_OID` に設定された許可担当者のObject ID（例: `00000000-0000-4000-8000-000000000011`）と一致する場合だけ、次の3 APIのGETを許可します。未設定・空文字・不正形式・別人OIDの場合は403で拒否されます。また許可担当者は勤怠の許可ユーザー設定（`ATTENDANCE_ALLOWED_USERS`）にも含まれている必要があります。

- /api/dashboard
- /api/vacation-summaries
- /api/paid-leave-compliance

署名・発行元・対象API・テナント・期限・スコープ・許可Object IDの検証を通過後にクライアント制限を適用します。メール/UPNや未検証トークンを本人判定に使いません。
他APIとHEAD/POST/PATCH/PUT/DELETE等は許可しません。定義されたハンドラは403、未定義メソッドは405になる場合があります。

OPTIONSはNext.jsの自動応答（204、空本文、Allow）です。DB操作と業務ハンドラを実行せず、データ取得・更新権限を与えません。AllowにGET/HEAD/POST等が表示されてもcompany-reportへの許可を意味しません。
Access-Control-Allow-OriginやAccess-Control-Allow-Credentialsを追加していません。別originからのAuthorization付きブラウザ通信は事前確認で止まります。
親と子はpostMessageで連携し、子iframe内のapiFetchはwindow.location.originと同じoriginのAPIだけを呼ぶため、親originから子APIを直接呼ぶCORS許可は不要です。

## 勤怠画面とcompany-reportの許可範囲を分離する設定

勤怠画面のクライアント（`3b2b5c62-16cc-42df-b275-e50c3084fb95`）では、既存の許可ユーザー全員について、画面が必要とする既存GET・取込POST・社員設定PATCHを維持します。company-reportの3GET制限は勤怠画面へ適用しません。
APIの本人判定は署名検証済み `oid` を使います。`ATTENDANCE_ALLOWED_USERS` はサーバー側の許可設定で、そのメール/UPNは既存 `NEXT_PUBLIC_ALLOWED_AUTH_EMAILS` の範囲を維持する照合用です。トークンのメールやloginHint、クエリパラメータでは許可を付与しません。

既存6名を維持するための設定対応例（ダミー値）は次のとおりです。実際の本番環境変数の適用は別途承認後に行います。

| 利用者（例） | Object ID（例） | 既存許可UPNとの対応（例） |
| --- | --- | --- |
| 山田 太郎 | 00000000-0000-4000-8000-000000000011 | user1@example.com |
| 佐藤 花子 | 00000000-0000-4000-8000-000000000012 | user2@example.com |
| 鈴木 一郎 | 00000000-0000-4000-8000-000000000013 | user3@example.com |
| 高橋 次郎 | 00000000-0000-4000-8000-000000000014 | user4@example.com |
| 伊藤 三郎 | 00000000-0000-4000-8000-000000000015 | user5@example.com |
| 渡辺 四郎 | 00000000-0000-4000-8000-000000000016 | user6@example.com |

この6名を勤怠の許可設定へ追加しても、company-reportの許可は `COMPANY_REPORT_ALLOWED_OID` で指定された許可担当者（`user1@example.com` に対応する1名）だけです。未設定・空文字・不正形式・別人OIDの場合はcompany-reportからのアクセスはすべて拒否されます。またcompany-reportではリクエストの経路・メソッドが確認できない場合も拒否します。勤怠許可設定が空または不正なら全APIを拒否し、メールに基づく認証へ切り替えません。
開発用 `.env.local` と本番環境変数はこの修正では変更していません。現在の開発設定は許可担当者1名分です。6名全員の実ログイン検証には、実環境の対応表をサーバー側設定へ適用する承認が別途必要です。

## 開発環境での実HTTP回帰確認

開発APIを127.0.0.1:3001で起動した後、リポジトリルートで node scripts/check-api-http.mjs を実行します。
固定の開発URLにだけ、3 origin×9ルートのOPTIONSと、偽トークンによる6業務メソッド×9ルートを送ります。本番へ接続せず、業務データや有効トークンを出力しません。
認証済みcompany-reportの3GET許可と他操作拒否は api-auth.test.ts / company-report-routes.test.ts で署名済みテストトークン・DB spyを使い確認します。OPTIONSのHTTP層は上の別テストで確認します。

ブラウザでも一時ページから同一originのGETが401の本文を読めること（CORSでは妨げられない）、別originのAuthorization付きGETが事前確認で遮断されることを確認済みです。有効な本人トークンでの画面表示とは別の確認です。
公式説明: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
