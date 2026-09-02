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
