import type { ReleaseLocale } from "../release-content";

const locale = {
  ui: {
    allReleases: "すべてのリリース",
    backToReleases: "リリース一覧に戻る",
    firstRelease: "これが最初のリリースです",
    historyDescription: "履歴を開くと、公開済みのタグをすべて確認できます。",
    latestRelease: "最新版を表示しています",
    metaDescription: "タグ付きの各 Pinar リリースに対応する公式ノートです。",
    next: "次へ",
    pageDescription:
      "各ノートは公開済みのバージョン、または次回リリース用に準備されたバージョンに対応し、範囲外の作業は含まれません。",
    pageTitle: "Pinar の新着情報",
    previous: "前へ",
    releaseNavigation: "リリースのナビゲーション",
    releaseNotFound: "リリースが見つかりません",
    releaseNotFoundDescription: "このリリースは公開履歴にありません。",
    viewDetails: "詳細を見る",
    whatChanged: "変更内容",
  },
  releases: {
    "v0.5.0": {
      title: "コレクションのレビュー担当と、落ち着いたワークスペース",
      summary: "Pro アカウントは、1つのコレクションにレビュー担当を招待できます。ホスト版 Cloud は、そのアカウントの現在の提供内容に従います。ビューアはセッションを開くとプロンプトをコピーを準備し、ワークスペースの一覧はバックグラウンドの読み込みを減らして更新します。",
      changes: {
        "cloud-offer-eligibility": {
          title: "Cloud の利用資格は現在の提供内容に従います",
          description: "ローカルアプリとセルフホストのサーバーは無料のままです。ホスト版 Pinar Cloud は、現在の提供内容とそのアカウントの利用資格に従います。新しいアカウントは一時的な評価を受け取る場合があり、以前のアカウントはすでにある利用資格を保てます。すべてのアカウントに共通の期限はありません。プランのページが評価を案内しているときは、クレジットカードなしで Pinar Cloud を14日間、最大250 MB まで使えます。音声文字起こしは Pro の特典のままです。評価のあいだ、ストレージと AI クレジットの追加は Pro が必要です。",
        },
        "collection-reviewers": {
          title: "1つのコレクションにレビュー担当を招待",
          description: "Pro アカウントは、メールで誰かを招待し、1つのコレクションの閲覧とレビューができます。招待された人はサインインしてアプリで承諾します。所有者はアクセスを取り消せます。所有者の Pro が終わると、そのコレクションは一覧に残りますが、Pro が再び有効になるまでレビューは止まります。招待は他のコレクションには及びません。",
        },
        "viewer-prompt-ready": {
          title: "ビューアを開くとプロンプトをコピーの準備が整います",
          description: "グループ化されたセッションを開くと、プロンプトをコピーをバックグラウンドで準備します。読み込み中のボタンはプロンプトを準備しています…、失敗するとプロンプトを準備できませんでしたと表示します。プロンプトをコピーは主操作のままです。プロンプトを開く *.md はセッションのメニューに残ります。",
        },
        "quieter-workspace-refresh": {
          title: "ワークスペースの一覧は、更新の間隔が長くなりました",
          description: "セッション一覧は、数秒ごとではなく約30秒ごとに外部の変更を確認します。タブに戻る、または作成、移動、削除、共有をすると、バッチと共有リンクはすぐに更新されます。すでに共有されているセッションは、そのあいだも共有の表示を保ちます。",
        },
      },
    },
    "v0.4.7": {
      title: "拡張機能の設定から Cloud にサインイン",
      summary: "ウェブサイトで作成済みのアカウントに届くメールコードで、拡張機能から Pinar Cloud にサインインできます。設定は「環境設定」と「キャプチャ」に整理されました。",
      changes: {
        "extension-cloud-account-settings": {
          title: "メールでのサインインと分かりやすい設定",
          description: "まず pinar.dev でアカウントを作成し、拡張機能のリモートサーバー設定からメールコードをリクエストしてください。規約への同意はウェブサイトで行います。環境設定には保存先、言語、テーマを、キャプチャにはエージェントへの受け渡しとプライバシーをまとめました。",
        },
      },
    },
    "v0.4.6": {
      title: "メール認証と Pro アクセスを改善",
      summary: "メール認証の法的案内を簡潔にしました。Pro が付与されたアカウントには通常のプラン枠が適用されます。",
      changes: {
        "sign-in-and-complimentary-pro": {
          title: "メール認証と Pro の特典",
          description: "サインイン画面で法的文書のバージョン表示を省き、メールアドレス変更ボタンを枠線付きにしました。無償で Pro が付与されたアカウントには、通常の Pro ストレージ枠と AI クレジットが適用されます。",
        },
      },
    },
    "v0.4.5": {
      title: "フッターとアカウントメニューを改善",
      summary: "ホームページのフッターがコンテンツの直後に続くようになりました。プランと請求の操作は利用できる場合だけ表示されます。",
      changes: {
        "landing-footer-and-account-menu": {
          title: "ホームページの余白を削減",
          description: "支援カードとフッターがコンテンツの直後に表示されます。Stripe の顧客情報がない Free アカウントにはプランへのリンクを表示し、請求情報がないアカウントには利用できない請求リンクを表示しません。",
        },
      },
    },
    "v0.4.4": {
      title: "メールアカウントと年間プラン",
      summary: "Pinar Cloud Free はメール認証から利用を開始します。Pro は年間料金のみとなり、保存期間、ストレージ、追加パックの説明も明確になりました。",
      changes: {
        "email-first-cloud": {
          title: "メールで Cloud にサインイン",
          description: "メールで届く6桁のコードで Free アカウントを作成またはサインインできます。一時メールのドメインは拒否し、独自ドメインは利用できます。拡張機能は一時サインインコードを生成しなくなりました。",
        },
        "annual-only-pricing": {
          title: "Pro は年間プランのみ",
          description: "新規 Pro 契約はブラジルで年額 R$99、その他の地域で年額 US$29 です。既存契約の料金は維持されます。Free Cloud の保存期間は30日、Pro には2 GB と初回500 AIクレジットが含まれます。月額と Founder の提供を終了し、料金ページの法的案内をフッターに移しました。",
        },
      },
    },
    "v0.4.3": {
      title: "バージョンから場所の表示を外す",
      summary: "設定にはバージョン番号だけを表示します。クラウドかこのコンピュータかは、アドレスを見れば分かります。",
      changes: {
        "version-without-runtime-badge": {
          title: "バージョン横のクラウド表示を削除",
          description: "バージョンの横にクラウドやローカルを繰り返さなくなりました。どちらかはサイトのアドレスが示しています。",
        },
      },
    },
    "v0.4.2": {
      title: "拡張機能はサインインしたまま",
      summary:
        "ブラウザに Pinar のウェブサイトセッションがあっても、拡張機能は Unauthorized を表示しなくなります。",
      changes: {
        "extension-session-isolation": {
          title: "拡張機能のサインインはサイトと独立",
          description:
            "リモート保存は拡張機能自身の資格情報を使います。ウェブサイトのセッションは、拡張機能が資格情報を送らなかったときだけ使われるため、古いサイトログインが拡張機能を止めません。",
        },
      },
    },
    "v0.4.1": {
      title: "持続可能な AI クレジットと適正なストレージ",
      summary:
        "Pro は初回に一度だけ 500 Pinar Cloud AI クレジットと 2 GB のクラウドストレージを付与します。追加パックは小さく分かりやすくなり、毎月の補充なしで 12 か月間有効です。",
      changes: {
        "sustainable-ai-credits": {
          title: "初回 500 Pinar Cloud AI クレジット",
          description:
            "最初の Pro 契約で 500 Pinar Cloud AI クレジットを一度だけ付与します。音声文字起こしは 60 秒まで 1 クレジット、61～120 秒は 2 クレジットを使用し、追加分は 12 か月有効の 500 クレジットパックで購入できます。",
        },
        "right-sized-storage": {
          title: "Pro は 2 GB、追加は 1 GB と 5 GB",
          description:
            "Pro には 2 GB のクラウドストレージが含まれます。購入できる追加パックは 1 GB と 5 GB で、積み重ね可能かつ 12 か月有効です。以前購入した 5 GB と 20 GB の付与分も維持されます。",
        },
        "storage-expiry-protection": {
          title: "ストレージ期限後の明確な流れ",
          description:
            "使用量が残りの上限を超える場合、期限切れ時に新規アップロードを停止します。超過分には 30 日の猶予があり、90 日目までは復元可能で、その後に別途監査される削除処理の対象候補になります。",
        },
      },
    },
    "v0.4.0": {
      title: "連続キャプチャ、統合レビュー、各ピンでの AI",
      summary:
        "キャプチャセッションがページをまたいで継続し、すべてのスクリーンショットとピンを1件の記録として保存します。レビューはビューアーに統合され、Founder の新規提供を終了し、ピンには構造、技術的証拠、AI アクションが加わりました。",
      changes: {
        "continuous-capture-session": {
          title: "ページをまたぐ1つの連続セッション",
          description:
            "1ページでピン留めし、そのまま移動して最後に一度だけ完了します。Pinar は移動前に各ピンをキャプチャし、ページをまたいで番号を維持して、バッチスロットなしで全行程を1セッションに保存します。",
        },
        "unified-session-review": {
          title: "すべての画面とピンをまとめてレビュー",
          description:
            "複数ページのセッションは、全注釈をサイドパネルに並べた1つのパン・ズームビューアーで開きます。Tab で現在のキャプチャをレビューし、Esc でツールバーを隠し、保存済みセッションはビューアー内で確認します。",
        },
        "founder-retired": {
          title: "Founder の新規提供を終了",
          description:
            "新規購入は Free と Pro のみになりました。Founder の加入者は存在しないため、移行は提供を削除し、想定外の Founder アカウント、購入、付与、キャプチャ、または有効な予約を検出した場合は明示的な処理のため停止します。",
        },
        "element-structure": {
          title: "すべての要素ピンに構造",
          description:
            "各要素ピンは HTML ツリー、既定値と異なる計算済みスタイル、フォント、アイコン、周囲の要素を保存します。ビューアーは「構造」に表示し、pinar-visual-context ブロックに含まれます。",
        },
        "technical-evidence": {
          title: "技術的な証拠",
          description:
            "ピン留め中に観測したコンソールエラー、失敗したリクエスト、環境をピンと一緒に列挙し、「操作直後」または「同じページ」に区分します。推測は含まれず、Pinar Cloud クレジットも消費しません。",
        },
        "pin-diagnosis": {
          title: "Pinar Cloud でピンを診断する（3 クレジット）",
          description:
            "AI がピンの構造から推定原因を説明し、信頼度付きの CSS 修正案を提案します。受け入れ、編集、破棄を選べ、受け入れた診断だけがピンに残ります。",
        },
        "save-as-component": {
          title: "Pinar Cloud でピンをコンポーネントとして保存（10 クレジット）",
          description:
            "取得した要素を HTML + CSS、React + Tailwind、Preact + htm に変換します。ファイル、依存関係、忠実度のメモ、プレビュー、ZIP ダウンロード、StackBlitz に対応します。",
        },
        "step-recording": {
          title: "再現手順を記録して整理",
          description:
            "ページで G を押すとクリック、入力、スクロール、ナビゲーションを記録します。Pinar を再び開き、ピンを付けてコピーするとタイムラインが添付され、もう一度 G を押すと破棄されます。ビューアーは記録をローカルエージェント向けの簡潔な文章の手順に変換します。",
        },
        "collection-design-system": {
          title: "Pinar Cloud でコレクションのデザインシステムを生成（15 クレジット）",
          description:
            "コレクションのピンから共通する色、タイポグラフィ、余白、角丸、影を抽出します。CSS 変数、Tailwind テーマ、W3C トークン、DESIGN.md として書き出せます。",
        },
        "windows-tray-icon": {
          title: "鮮明な Windows トレイアイコン",
          description:
            "通知領域のアイコンはディスプレイの拡大率が求めるサイズで描画されるため、125%、150%、200% でもぼやけません。",
        },
      },
    },
    "v0.3.6": {
      title: "トレイのアップデート確認が見えるようになりました",
      summary:
        "メニューバーアプリは「アップデートを確認中」「最新です」「アップデートの確認に失敗」を表示し、それぞれ 10 秒のカウントダウンのあと「アップデートを確認」に戻ります。",
      changes: {
        "tray-update-status": {
          title: "トレイのアップデート確認の状態",
          description:
            "「アップデートを確認」は実行中に「アップデートを確認中」になります。最新なら「最新です (10s)」、失敗なら「アップデートの確認に失敗 (10s)」です。どちらもカウントダウンのあと「アップデートを確認」に戻ります。カウントダウン中のクリックで再確認します。",
        },
      },
    },
    "v0.3.5": {
      title: "アカウントタブ、一回払いの Founder のみ、より早いキャプチャコピー",
      summary:
        "拡張機能のアカウントタブは1行のコード帯です。一回払いプランは Founder だけです。キャプチャはコメントの準備ができ次第コピーし、Alt+Enter は Ctrl+Enter と同じです。",
      changes: {
        "account-tab-options": {
          title: "アカウントタブのコード帯",
          description:
            "Free インストールはアイコン1行で一時コードを生成し、フィールドの下にカウントダウンを出します。有料アカウントはメールとプランを表示し、ログアウトは outline、請求管理は Pro だけです。",
        },
        "lifetime-folded-into-founder": {
          title: "Lifetime は Founder",
          description:
            "一回払いプランは Pinar Founder だけです。チェックアウトは古い lifetime_founder メタデータをまだ受け付けます。Lifetime のラベル、env、Stripe Price の別名はありません。",
        },
        "capture-copy-sooner": {
          title: "スクリーンショット保存より先にコピー",
          description:
            "Ctrl+Enter、Command+Enter、または Alt+Enter は、ヘルパーがスクリーンショットを保存している間に、先にコメントとロケータをコピーします。貼り付けの準備ができてからも進捗が 80% のままになりません。",
        },
      },
    },
    "v0.3.4": {
      title: "続行で現行ポリシーに同意",
      summary:
        "プランで支払うか、アカウントのコードを確認すると、現行の利用規約、プライバシーポリシー、許容される利用に同意します。追加のダイアログはありません。",
      changes: {
        "checkout-policy-acceptance": {
          title: "支払うと同意",
          description:
            "プランで有料チェックアウトを始めると、現行の利用規約、プライバシーポリシー、許容される利用を記録します。追加の確認ダイアログはなくなりました。",
        },
        "sign-in-policy-acceptance": {
          title: "ログインすると同意",
          description:
            "アカウントのメールコードを確認すると、同じ現行ポリシーを記録します。追加の同意ステップはなくなりました。リモート Free は拡張機能のオプションで引き続き同意します。",
        },
      },
    },
    "v0.3.3": {
      title: "ローカルのアカウントメニューと AI なしの Free",
      summary:
        "ローカルワークスペースは Free と同じアカウントのポップオーバーを使います。ホームページはそのメニューにあり、Free には AI クレジットも要約も含まれません。",
      changes: {
        "local-account-menu": {
          title: "ローカルのアカウントメニュー",
          description:
            "ローカルワークスペースのフッターは、Free と同じアカウントのポップオーバーを開きます。ホームページはメニュー内です。ローカルには終了するクラウドセッションがないため、サインアウトは出しません。",
        },
        "free-without-ai": {
          title: "Free に AI なし",
          description:
            "Free は AI クレジットを付与せず、AI 要約も表示しません。要約は Pro、Founder、Lifetime に残します。プランとヘルプもその制限に合わせます。",
        },
      },
    },
    "v0.3.2": {
      title: "完全な Windows インストーラー",
      summary:
        "Windows のダウンロードは完全な Setup ZIP になりました。展開し、.installer フォルダーの隣の Pinar-Setup.exe を実行します。",
      changes: {
        "windows-setup-zip": {
          title: "完全な Windows Setup ZIP",
          description:
            "GitHub Releases は win-x64-Pinar-Setup.zip を公開し、Pinar-Setup.exe と .installer のペイロードを同梱します。1.2 MB のスタブ exe は単体ではインストールできないため、一覧から外しました。",
        },
        "windows-help-links": {
          title: "Windows インストールリンク",
          description:
            "ヘルプとオプションは ZIP をダウンロードします。展開後は .installer フォルダーを Pinar-Setup.exe の隣に置き、SmartScreen が出たら詳細情報から実行します。",
        },
      },
    },
    "v0.3.1": {
      title: "Windows アプリと記事ごとのヘルプ表紙",
      summary:
        "Windows の通知領域から Pinar を起動し、Setup インストーラーを入手し、各ヘルプ記事を専用の表紙で開けます。",
      changes: {
        "windows-desktop-app": {
          title: "Windows デスクトップアプリ",
          description:
            "Pinar は Windows 向けのトレイアプリを同梱します。win-x64-Pinar-Setup.exe をダウンロードしてインストーラーを実行し、通知領域からローカルヘルパーを起動します。macOS と同じローカルキャプチャの流れです。",
        },
        "unique-help-covers": {
          title: "記事ごとのヘルプ表紙",
          description:
            "27 件のヘルプ記事それぞれに専用の表紙画像が付き、インストール、初回キャプチャ、ショートカット、課金などのガイドが同じスクリーンショットを共有しなくなりました。",
        },
        "windows-first-run-help": {
          title: "Windows 初回起動のヘルプ",
          description:
            "インストールガイドは、初回の SmartScreen ブロックを越える手順を案内します。「詳細情報」を開き、「実行」を選びます。",
        },
      },
    },
    "v0.3.0": {
      title: "より分かりやすいワークスペースとキャプチャ",
      summary: "増え続けるコレクションを整理し、一か所で Pinar を設定し、より明確な視覚フィードバックとヘルプで各キャプチャを確認できます。",
      changes: {
        "workspace-organization": { title: "ワークスペースの整理", description: "ネストしたコレクションは、分かりやすい階層、サイズ変更可能なナビゲーション、コンパクトな操作、全項目表示でのコレクション情報により、大規模なライブラリにも対応します。" },
        "global-settings": { title: "グローバル設定", description: "一般、キャプチャ、プライバシー、インターフェース、テーマ、コピー詳細度の設定を一貫した専用画面にまとめました。" },
        "capture-feedback": { title: "明確なキャプチャフィードバック", description: "選択範囲の寸法、Pin コメントへのフォーカス、画像プレビュー、非表示領域、保存進捗により、キャプチャがより滑らかで予測しやすくなりました。" },
        "help-center": { title: "ヘルプセンターの改善", description: "インストールと初回キャプチャのガイドを簡潔にし、画像のズーム表示と長い記事での現在セクション表示を追加しました。" },
      },
    },
    "v0.2.0": {
      title: "キャプチャバッチと同期される設定",
      summary:
        "複数ページのキャプチャを 1 つのプロンプトにまとめ、すべての設定をサーバーに保持し、7 言語で Pinar を一貫して使えます。",
      changes: {
        "capture-batches": {
          title: "キャプチャバッチ",
          description:
            "Alt+Shift+B で次のキャプチャをまとめ始め、もう一度押すと終了して 1 つのプロンプトとしてコピーします。バッチはサイドバーのフォルダーに入り、Alt+Shift+X またはアイコンメニューでコピーせずに終了できます。",
        },
        "server-preferences": {
          title: "サーバー上の設定",
          description:
            "キャプチャ先、バッチのコピー、ハンドオフの形式、非表示にする URL キー、言語がサーバーに保存され、拡張機能と同期します。設定にキャプチャ・ハンドオフ・プライバシーのセクションが加わりました。",
        },
        "localized-everywhere": {
          title: "あらゆる場所で 7 言語",
          description:
            "ツールバー、アイコンメニュー、エージェントに渡すプロンプトが、ワークスペースやオプションと同じく選択した言語に従います。",
        },
        "progress-toolbar": {
          title: "ツールバーで進行状況",
          description:
            "Cmd+Enter でツールバーが進行状況バーになり（保存中・完了・エラー）、スクリーンショットのシャッターは 2 フレームだけになりました。バッチの終了は通知で結果を知らせます。",
        },
        "about-and-versioning": {
          title: "「情報」と単一バージョン",
          description:
            "設定 > 情報で Pinar の概要、バージョン、リリースノートを確認できます。製品バージョンは 1 つでアプリ・サイト・タグを統べ、本番ビルドはリリースタグからのみ作られます。",
        },
      },
    },
    "v0.1.5": {
      title: "ログイン時の起動を安定化",
      summary:
        "Pinar.app は、エージェントを不要に再読み込みすることなく、既存の macOS ログイン設定を保持するようになりました。",
      changes: {
        "idempotent-login-setup": {
          title: "冪等なログイン設定",
          description:
            "トレイは LaunchAgent が既に存在するかを確認してから設定するため、RunAtLoad による二重起動を避けます。",
        },
        "preference-preserved": {
          title: "設定の保持",
          description:
            "保存済みの Start at Login 設定は、通常起動時の unload/reload の繰り返しなしにそのまま維持されます。",
        },
      },
    },
    "v0.1.4": {
      title: "macOS トレイ起動の直列化",
      summary:
        "同時実行されたエージェントフックが、重複する Pinar.app インスタンスやゴースト Dock タイルを作れなくなりました。",
      changes: {
        "single-app-instance": {
          title: "アプリの単一インスタンス",
          description:
            "原子的な PID ロックにより、実行中のトレイが所有権を保ち、重複起動はきれいに終了します。",
        },
        "coordinated-hooks": {
          title: "フックの協調",
          description:
            "セッションフックとインストーラーは、互いに競合するのではなく、トレイ起動を直列化し、準備完了を待つようになりました。",
        },
      },
    },
    "v0.1.3": {
      title: "アカウントと iframe キャプチャの精度向上",
      summary:
        "アカウント管理、iframe の対象指定、アップロードの重複排除、公開ナビゲーション、トレイ起動の保護をまとめて磨き込みました。",
      changes: {
        "nested-iframe-locators": {
          title: "入れ子 iframe のロケーター",
          description:
            "キャプチャした DOM パスが各フレーム境界を保持するため、入れ子 iframe 内のピンをより正確に特定できます。",
        },
        "single-flight-uploads": {
          title: "単一フライトのアップロード",
          description:
            "繰り返されたキャプチャ要求は進行中のアップロードを共有し、重複セッションとアップロード競合を防ぎます。",
        },
        "account-clarity": {
          title: "アカウント情報の明確化",
          description:
            "拡張機能のアカウント画面で、プラン、ストレージ、請求、法的同意の状態を把握しやすく、管理しやすくなりました。",
        },
        "duplicate-launch-guard": {
          title: "重複起動の防止",
          description:
            "エージェントのセッションフックは、別インスタンスを開く前に、すでに動作中の macOS トレイを検出します。",
        },
      },
    },
    "v0.1.2": {
      title: "macOS 向け Pinar.app",
      summary:
        "ローカルの Pinar 体験は、組み込みヘルパー、ログイン制御、GitHub ベースの更新を備えたネイティブのメニューバーアプリへ移りました。",
      changes: {
        "native-menu-bar-app": {
          title: "ネイティブのメニューバーアプリ",
          description:
            "Pinar.app からワークスペースを開き、ローカルサーバーの開始と停止、使用中のポートの確認、Start at Login の制御ができます。",
        },
        "bundled-local-helper": {
          title: "同梱のローカルヘルパー",
          description:
            "アプリがローカルの Pinar ディレクトリを作成し、ヘルパーを実行し、対応する AI エージェントフックを登録するため、別途デーモンを入れる必要はありません。",
        },
        "automatic-updates": {
          title: "自動更新",
          description:
            "アプリは GitHub Releases で公開された署名済み成果物を確認し、意図しないダウングレードを拒否します。",
        },
        "unified-macos-installer": {
          title: "統合 macOS インストーラー",
          description:
            "公開インストーラーは、macOS の対応ローカル製品として Pinar.app をダウンロード、インストール、起動するようになりました。",
        },
      },
    },
    "v0.1.1": {
      title: "ビジュアルキャプチャ、クラウドワークスペース、Founder",
      summary:
        "最初のタグ付き製品リリースは、ブラウザ注釈をローカルおよびクラウドのワークスペース、AI エージェントへのハンドオフ、共有、プラン、プライバシー制御につなぎました。",
      changes: {
        "element-and-area-capture": {
          title: "要素と領域のキャプチャ",
          description:
            "1つまたは複数の DOM 要素や自由領域にピンを付け、コメントを書き、スクリーンショットを撮り、Chrome から構造化バンドルをコピーできます。",
        },
        "local-helper-and-agent-hooks": {
          title: "ローカルヘルパーとエージェントフック",
          description:
            "ループバックヘルパーがスクリーンショットと履歴を保存し、インストール済みのセッションフックが対応コーディングエージェントを Pinar コンテキストの受け取りに備えます。",
        },
        "cloud-workspace-and-sharing": {
          title: "クラウドワークスペースと共有",
          description:
            "パスワードレスアカウント、プロジェクト、入れ子コレクション、キャプチャビューアー、非掲載のセッション・プロジェクト・コレクションリンクが同時に加わりました。",
        },
        "plans-ai-and-storage": {
          title: "プラン、AI、ストレージ",
          description:
            "Free、Pro、人数限定の Founder により、クラウド保持、ストレージ上限、AI 要約、サブスクリプション、任意のクレジットまたはストレージパックが導入されました。",
        },
        "privacy-and-legal-controls": {
          title: "プライバシーと法的コントロール",
          description:
            "機密フィールドのリダクション、手動マスク、バージョン付き同意、公開済みのサービスポリシーが、クラウドの安全境界を定めました。",
        },
      },
    },
  },
} satisfies ReleaseLocale;

export default locale;
