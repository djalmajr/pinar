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
      "各ノートは公開済みのリポジトリタグに対応しており、未リリースの作業は含まれません。",
    pageTitle: "Pinar の新着情報",
    previous: "前へ",
    releaseNavigation: "リリースのナビゲーション",
    releaseNotFound: "リリースが見つかりません",
    releaseNotFoundDescription: "このリリースは公開履歴にありません。",
    viewDetails: "詳細を見る",
    whatChanged: "変更内容",
  },
  releases: {
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
