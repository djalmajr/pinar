import type { ReleaseLocale } from "../release-content";

const locale = {
  ui: {
    allReleases: "全部版本",
    backToReleases: "返回更新日志",
    firstRelease: "这是第一个版本",
    historyDescription: "打开历史记录即可查看所有已发布的标签。",
    latestRelease: "您已是最新版本",
    metaDescription: "Pinar 每个已打标签版本的官方说明。",
    next: "下一篇",
    pageDescription:
      "每条说明都对应仓库中已发布的标签，不会混入尚未发布的工作。",
    pageTitle: "Pinar 新功能",
    previous: "上一篇",
    releaseNavigation: "版本导航",
    releaseNotFound: "未找到该版本",
    releaseNotFoundDescription: "该版本不在已发布的历史记录中。",
    viewDetails: "查看详情",
    whatChanged: "更新内容",
  },
  releases: {
    "v0.3.0": {
      title: "更清晰的工作区与捕获流程",
      summary: "轻松整理不断增长的收藏，在统一设置中调整 Pinar，并通过更清晰的视觉反馈和帮助检查每次捕获。",
      changes: {
        "workspace-organization": { title: "工作区整理", description: "嵌套收藏现在可承载更大的资料库，并提供更清晰的层级、可调整大小的导航、紧凑控件以及全部项目视图中的收藏上下文。" },
        "global-settings": { title: "全局设置", description: "专用设置区域统一管理常规、捕获、隐私、界面、主题和复制详细程度偏好。" },
        "capture-feedback": { title: "更清晰的捕获反馈", description: "选择尺寸、自动聚焦的 Pin 评论、图片预览、隐藏区域处理和保存进度让捕获流程更流畅、更可预测。" },
        "help-center": { title: "改进的帮助中心", description: "安装和首次捕获指南更加简洁清晰，图片支持缩放预览，长文章会突出显示当前可见章节。" },
      },
    },
    "v0.2.0": {
      title: "捕获批次与同步的偏好设置",
      summary:
        "把多个页面的捕获归入一个提示词，把所有偏好设置保存在服务器上，并以七种语言完整使用 Pinar。",
      changes: {
        "capture-batches": {
          title: "捕获批次",
          description:
            "按 Alt+Shift+B 开始归组接下来的捕获；再按一次结束并将它们复制为一个提示词。批次位于侧栏的一个文件夹中，Alt+Shift+X 或图标菜单可在不复制的情况下关闭批次。",
        },
        "server-preferences": {
          title: "服务器上的偏好设置",
          description:
            "捕获目标、批次复制、交接格式、隐藏的 URL 键和语言都保存在服务器上，并与扩展保持同步。设置新增了捕获、交接和隐私分区。",
        },
        "localized-everywhere": {
          title: "处处七种语言",
          description:
            "工具栏、图标菜单和交给智能体的提示词都遵循所选语言，与工作区和选项页一致。",
        },
        "progress-toolbar": {
          title: "工具栏中的进度",
          description:
            "Cmd+Enter 将工具栏变为进度条——保存中、完成或错误——截图快门现在只需两帧。结束批次时会以通知报告结果。",
        },
        "about-and-versioning": {
          title: "关于与单一版本",
          description:
            "设置 > 关于显示 Pinar 是什么、当前版本和更新说明。产品只有一个版本号，驱动应用、网站和标签；生产构建只能来自发布标签。",
        },
      },
    },
    "v0.1.5": {
      title: "登录时可靠启动",
      summary:
        "Pinar.app 现在会保留现有的 macOS 登录配置，而不会无谓地重新加载 LaunchAgent。",
      changes: {
        "idempotent-login-setup": {
          title: "幂等的登录启动配置",
          description:
            "托盘应用会先检查 LaunchAgent 是否已经存在再进行配置，避免因 RunAtLoad 再次启动。",
        },
        "preference-preserved": {
          title: "保留偏好设置",
          description:
            "已保存的「登录时启动」偏好在正常启动过程中保持不变，不会反复卸载再加载。",
        },
      },
    },
    "v0.1.4": {
      title: "串行化的 macOS 托盘启动",
      summary:
        "并发的智能体会话钩子不再会创建重复的 Pinar.app 实例或幽灵 Dock 图标。",
      changes: {
        "single-app-instance": {
          title: "单一应用实例",
          description:
            "原子 PID 锁让正在运行的托盘应用保持所有权，重复启动会干净退出。",
        },
        "coordinated-hooks": {
          title: "协调启动钩子",
          description:
            "会话钩子和安装程序现在会串行启动托盘应用并等待就绪，而不再互相抢跑。",
        },
      },
    },
    "v0.1.3": {
      title: "更清晰的账户与 iframe 捕获流程",
      summary:
        "账户管理、iframe 定位、上传去重、公开导航以及托盘启动保护一并打磨完成。",
      changes: {
        "nested-iframe-locators": {
          title: "嵌套 iframe 定位器",
          description:
            "捕获的 DOM 路径现在会保留每一层 frame 边界，嵌套 iframe 内的图钉可以更精确地定位。",
        },
        "single-flight-uploads": {
          title: "单次飞行上传",
          description:
            "重复的捕获请求会共享同一次进行中的上传，避免重复会话和上传竞态。",
        },
        "account-clarity": {
          title: "更清晰的账户信息",
          description:
            "扩展的账户界面现在更容易查看和管理套餐、存储、账单以及法律同意状态。",
        },
        "duplicate-launch-guard": {
          title: "重复启动防护",
          description:
            "智能体会话钩子会在尝试打开另一个实例前，检测 macOS 托盘应用是否已在运行。",
        },
      },
    },
    "v0.1.2": {
      title: "macOS 版 Pinar.app",
      summary:
        "本地 Pinar 体验迁入原生菜单栏应用，内置 helper、登录控制，以及基于 GitHub 的更新。",
      changes: {
        "native-menu-bar-app": {
          title: "原生菜单栏应用",
          description:
            "从 Pinar.app 打开工作区、启动或停止本地服务器、查看活动端口，并控制「登录时启动」。",
        },
        "bundled-local-helper": {
          title: "内置本地 helper",
          description:
            "应用会创建本地 Pinar 目录、运行 helper，并注册受支持的 AI 智能体钩子，无需单独安装守护进程。",
        },
        "automatic-updates": {
          title: "自动更新",
          description:
            "应用会检查通过 GitHub Releases 发布的已签名制品，并拒绝意外降级。",
        },
        "unified-macos-installer": {
          title: "统一的 macOS 安装程序",
          description:
            "公开安装程序现在会下载、安装并启动 Pinar.app，作为 macOS 上受支持的本地产品。",
        },
      },
    },
    "v0.1.1": {
      title: "视觉捕获、云工作区与 Founder",
      summary:
        "首个带标签的产品版本把浏览器标注连接到本地和云工作区、AI 智能体交接、分享、套餐以及隐私控制。",
      changes: {
        "element-and-area-capture": {
          title: "元素与区域捕获",
          description:
            "在 Chrome 中为单个或多个 DOM 元素或自由区域添加图钉、撰写评论、截取屏幕，并复制结构化数据包。",
        },
        "local-helper-and-agent-hooks": {
          title: "本地 helper 与智能体钩子",
          description:
            "回环 helper 存储截图和历史，已安装的会话钩子让受支持的编码智能体随时接收 Pinar 上下文。",
        },
        "cloud-workspace-and-sharing": {
          title: "云工作区与分享",
          description:
            "无密码账户、项目、嵌套集合、捕获查看器，以及未列出的会话、项目和集合链接一并推出。",
        },
        "plans-ai-and-storage": {
          title: "套餐、AI 与存储",
          description:
            "Free、Pro 和限量 Founder 权限引入了云保留期、存储配额、AI 摘要、订阅，以及可选的积分或存储包。",
        },
        "privacy-and-legal-controls": {
          title: "隐私与法律控制",
          description:
            "敏感字段脱敏、手动遮罩、版本化同意以及已发布的服务政策，确立了云端安全边界。",
        },
      },
    },
  },
} satisfies ReleaseLocale;

export default locale;
