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
      "每条说明都对应已发布的版本或为下一次发布准备的版本，不会混入范围之外的工作。",
    pageTitle: "Pinar 新功能",
    previous: "上一篇",
    releaseNavigation: "版本导航",
    releaseNotFound: "未找到该版本",
    releaseNotFoundDescription: "该版本不在已发布的历史记录中。",
    viewDetails: "查看详情",
    whatChanged: "更新内容",
  },
  releases: {
    "v0.7.1": {
      title: "Windows 上更稳定的 Pinar 托盘",
      summary:
        "Windows 托盘在被强制关闭后可以重新启动，退出更快，后台工作更少，并会在其运行时的内存增长拖慢电脑之前自行替换。",
      changes: {
        "tray-reliability": {
          title: "托盘总能启动，退出更快",
          description:
            "通过任务管理器结束托盘后，Pinar 可能拒绝再次启动，直到手动删除锁文件；现在它能识别旧托盘已不存在。从托盘菜单退出时不再等待后台计时器，托盘也不再每两秒重建菜单并重新读取开机启动设置。",
        },
        "tray-memory-guard": {
          title: "防止托盘内存增长",
          description:
            "托盘底层的桌面运行时即使空闲也会持续占用内存。在上游修复之前，托盘每五分钟检查一次自身内存，超过 2 GB 时会悄悄用新的托盘替换自己。本地服务器保持运行，捕获和智能体不会中断。",
        },
      },
    },
    "v0.7.0": {
      title: "带语音的本地 AI、通往 Pinar Cloud 的路径，以及更清晰的捕获目标",
      summary:
        "Pinar Local 再次通过你自己的 OpenAI 兼容端点使用 AI，并新增语音评论。你可以把本地工作带到 Pinar Cloud，在一个菜单中选择捕获保存的位置，并了解登录验证码为何没有送达。",
      changes: {
        "local-ai-voice": {
          title: "支持语音评论的本地 AI 和 BYOK",
          description:
            "Pinar Local 的“设置 → AI”可连接本地服务器或你自己的 OpenAI 兼容提供商，密钥保存在系统凭据库中。配置转写模型后，扩展在本地模式下录制语音评论，由本地服务器转写，并可选择把转写整理成评论和验收标准。不消耗 Pinar 额度。",
        },
        "local-to-cloud-import": {
          title: "把本地工作带到 Pinar Cloud",
          description:
            "“设置 → 数据”可将 Pinar Local 的项目、集合、批次、会话和截图导出为一个文件。在 Pinar Cloud 中，同一部分会逐个会话导入该文件，并显示进度和取消按钮。再次导入同一文件会更新已导入的内容，而不会重复。",
        },
        "capture-destination-picker": {
          title: "在一个菜单中选择捕获目标",
          description:
            "应用和扩展选项通过一个级联菜单选择新捕获的保存位置：先选项目，再选集合，支持搜索和图标，并在字段中显示所选路径。选择会在扩展和服务器之间保持同步。",
        },
        "sign-in-delivery-errors": {
          title: "无法发送验证码时给出清晰的错误",
          description:
            "当登录邮件无法送达时，Pinar 现在会用你的语言说明，而不是显示验证码已发送。无论该地址是否有账户，响应都相同。",
        },
        "windows-desktop": {
          title: "更稳定的 Windows 版 Pinar",
          description:
            "Windows 应用会从托盘启动本地服务器，遵循开机启动设置，安装智能体会话钩子，并且在读取 AI 密钥时不再弹出 PowerShell 窗口。",
        },
      },
    },
    "v0.6.0": {
      title: "MCP 完整管理、聚焦交接与更简洁的图钉对话框",
      summary:
        "代理现在可以通过 MCP 管理项目、集合、批次、会话、图钉和评论——在 Local 无需账号，在 Cloud 使用带作用域的密钥。默认情况下，结束会话时紧凑交接只包含仍需处理的图钉，viewer 的图钉对话框也去掉了技术标签页。",
      changes: {
        "mcp-crud": {
          title: "通过 MCP 完整管理会话与组织",
          description:
            "代理可以通过 MCP 创建、读取、更新和删除项目、集合、批次、会话、图钉和图钉评论。Pinar Local 在同一台机器上为代理提供这些操作，无需账号或密钥；Pinar Cloud 会对每个操作应用密钥的权限与作用域。",
        },
        "focused-handoff": {
          title: "聚焦交接，完整详情可随取随用",
          description:
            "默认情况下，结束会话时，只有仍需处理的图钉会进入紧凑交接，并附带页面上下文以便处理；会话的完整详情仍可通过交接中的链接访问。使用 Prompt 复制文本，使用 Link 仅复制会话链接，使用 Off 则不复制任何内容。图钉备注和会话评论仍可按 viewer 在 Local 与 Cloud 中的相同规则编辑。",
        },
        "viewer-technical-tabs-removed": {
          title: "去掉技术标签页的图钉对话框",
          description:
            "viewer 的图钉对话框不再提供技术标签页。图钉上下文现在直接在预览中显示，会话标签页优先打开，把评论、证据和编辑集中在一起。",
        },
      },
    },
    "v0.5.1": {
      title: "面向代理的 Cloud 访问与更清晰的 pin 审阅",
      summary:
        "Pro 账户可以为代理提供限定范围的 Cloud 密钥，并使用手动配置的 MCP 操作。查看器整合了每个 pin 的对话和审阅操作，共享链接的管理也更加清晰。",
      changes: {
        "cloud-agent-access": {
          title: "限定范围的代理密钥",
          description:
            "Pinar Cloud Pro 账户可以创建个人代理密钥，为其设置资源范围、权限和过期时间，查看密钥状态及最后使用时间，并随时撤销。具备读取权限的密钥可以访问其范围内的私有 Markdown 和图片。Pinar Local 不会签发这些密钥。",
        },
        "agent-mcp-operations": {
          title: "通过 MCP 使用 Pinar Cloud 操作",
          description:
            "兼容的 MCP 客户端可以使用 Cloud 操作；使用前需手动配置 HTTP 端点，并通过代理密钥设置 Authorization: Bearer 请求头。可用工具能够读取范围内的项目、集合、会话和批次数据、整理资源，并在密钥具备所需的账户级权限时显式发布或撤销共享链接。不包含 OAuth、自动发现、删除或计费操作。",
        },
        "viewer-sharing-followups": {
          title: "pin 对话与更清晰的共享控制",
          description:
            "查看器会将 pin 的原始备注、后续评论和代理执行结果整合到每个 pin 的对话中。获授权的用户可以发表评论，并完成或重新打开审阅。捕获缩略图可在支持缩放的视图中打开，pin 标签也更加清晰；如果捕获中有未检查的区域，还会显示隐私提醒。共享链接可以发布、复制和撤销；批量撤销仅针对会话的直接链接，不会撤销从项目、集合或批次继承的链接。",
        },
      },
    },
    "v0.5.0": {
      title: "集合审阅者，以及更安静的工作区",
      summary: "Pro 账户可以邀请审阅者加入一个集合。托管 Cloud 遵循该账户当前的方案。打开会话时，查看器会准备复制提示词，工作区列表也会减少后台加载。",
      changes: {
        "cloud-offer-eligibility": {
          title: "Cloud 资格遵循当前方案",
          description: "本地应用和自托管服务器仍然免费。托管的 Pinar Cloud 遵循当前方案以及该账户的资格：新账户可能获得一次临时评估，较早的账户可以保留已有资格。并非每个账户都有同一个截止日期。当方案页提供评估时，为 14 天 Pinar Cloud、最高 250 MB，且无需信用卡。语音转写仍是 Pro 权益。评估期间，存储和 AI 点数附加项需要 Pro。",
        },
        "collection-reviewers": {
          title: "邀请审阅者加入一个集合",
          description: "Pro 账户可以通过电子邮件邀请他人查看并审阅单个集合。受邀者登录后在应用中接受。所有者可以撤销访问。如果所有者的 Pro 结束，该集合仍留在列表中，但审阅会暂停，直到 Pro 再次生效。邀请不覆盖其他集合。",
        },
        "viewer-prompt-ready": {
          title: "打开查看器时，复制提示词已经备好",
          description: "打开分组会话会在后台准备复制提示词。加载时按钮显示正在准备提示词…，失败时显示无法准备提示词。复制提示词仍是主要操作。打开提示 *.md 仍留在会话菜单中。",
        },
        "quieter-workspace-refresh": {
          title: "工作区列表的刷新不再那么频繁",
          description: "会话列表现在大约每 30 秒检查一次外部变更，而不是每隔几秒。回到标签页，或进行创建、移动、删除、共享时，批次和共享链接会立即刷新。已经共享的会话在这些刷新之间仍保持共享标记。",
        },
      },
    },
    "v0.4.7": {
      title: "在扩展设置中登录云端",
      summary: "扩展使用已在网站创建的账户，通过邮件验证码登录 Pinar Cloud。设置现分为“偏好设置”和“捕获”。",
      changes: {
        "extension-cloud-account-settings": {
          title: "邮件登录与更清晰的设置",
          description: "请先在 pinar.dev 创建账户，再到扩展的远程服务器设置中获取邮件验证码。法律条款在网站上接受。偏好设置包含存储位置、语言和主题；捕获包含向代理交付内容和隐私选项。",
        },
      },
    },
    "v0.4.6": {
      title: "优化邮箱登录和 Pro 权益",
      summary: "邮箱验证页面的法律提示更加简洁。获赠 Pro 的账户可使用标准套餐额度。",
      changes: {
        "sign-in-and-complimentary-pro": {
          title: "邮箱验证和 Pro 权益",
          description: "登录页面不再显示法律文件版本，切换邮箱按钮改为描边样式。获赠 Pro 的账户可使用标准的 Pro 存储空间和 AI 点数。",
        },
      },
    },
    "v0.4.5": {
      title: "更清晰的页脚和账户菜单",
      summary: "首页页脚现在紧跟内容。账户菜单只显示可用的套餐和账单操作。",
      changes: {
        "landing-footer-and-account-menu": {
          title: "减少首页空白",
          description: "支持卡片和页脚紧跟内容。没有 Stripe 客户记录的 Free 账户可以查看套餐；没有账单的账户不再显示不可用的账单链接。",
        },
      },
    },
    "v0.4.4": {
      title: "邮箱账户与年度方案",
      summary: "Pinar Cloud Free 现在通过邮箱验证码开始使用。Pro 只提供年度价格，保留期、存储空间和附加包说明更加清晰。",
      changes: {
        "email-first-cloud": {
          title: "通过邮箱登录 Cloud",
          description: "使用邮件中的六位验证码创建 Free 账户或登录。临时邮箱域名会被阻止，自有域名可以使用，扩展程序也不再生成临时登录码。",
        },
        "annual-only-pricing": {
          title: "仅提供 Pro 年度方案",
          description: "新的 Pro 订阅在巴西为每年 99 雷亚尔，其他地区为每年 29 美元。现有订阅保留原价格。Free Cloud 内容保留 30 天；Pro 包含 2 GB 空间和首次赠送的 500 个 AI 积分。月付和 Founder 套餐已下架，价格页的法律说明移至页脚。",
        },
      },
    },
    "v0.4.3": {
      title: "版本旁不再显示位置标签",
      summary: "设置里只显示版本号。网址本身已经说明你是在云端还是在这台电脑上。",
      changes: {
        "version-without-runtime-badge": {
          title: "版本旁边的云端标签已去掉",
          description: "关于页面不再在版本号旁边重复云端或本地。网站地址已经表明当前使用的是哪一种。",
        },
      },
    },
    "v0.4.2": {
      title: "扩展保持登录",
      summary: "当浏览器里同时有 Pinar 网站会话时，扩展不再显示 Unauthorized。",
      changes: {
        "extension-session-isolation": {
          title: "扩展登录与网站分开",
          description:
            "远程存储使用扩展自己的凭据。只有扩展没有发送凭据时才会使用网站会话，因此过期的网站登录不会挡住扩展。",
        },
      },
    },
    "v0.4.1": {
      title: "可持续的 AI 点数与更合适的存储空间",
      summary:
        "Pro 现在首次提供一次性的 500 个 Pinar Cloud AI 点数和 2 GB 云存储。附加包更小、更清晰，保持 12 个月有效期，不再每月补充点数。",
      changes: {
        "sustainable-ai-credits": {
          title: "初始 500 个 Pinar Cloud AI 点数",
          description:
            "首次订阅 Pro 会一次性获得 500 个 Pinar Cloud AI 点数。语音转写在 60 秒内使用 1 点，61 到 120 秒使用 2 点；额外点数以 500 点、有效期 12 个月的附加包提供。",
        },
        "right-sized-storage": {
          title: "Pro 含 2 GB，并提供 1 GB 与 5 GB 附加包",
          description:
            "Pro 包含 2 GB 云存储。可购买的存储包现为 1 GB 和 5 GB，可叠加且有效期为 12 个月；此前购买的 5 GB 和 20 GB 配额仍会保留。",
        },
        "storage-expiry-protection": {
          title: "存储到期后的明确处理路径",
          description:
            "如果使用量超过剩余配额，存储到期时会暂停新的上传。超额数据享有 30 天宽限期，并可恢复至第 90 天，之后才会进入单独审计的清理流程候选范围。",
        },
      },
    },
    "v0.4.0": {
      title: "连续捕获、统一审阅，以及每个图钉上的 AI",
      summary:
        "捕获会话现在可以跨页面持续进行，并将每张截图和每个图钉保存为一条记录。审阅统一到查看器中，Founder 新购方案已下线，图钉还新增了结构、技术证据和 AI 操作。",
      changes: {
        "continuous-capture-session": {
          title: "跨页面的一个连续会话",
          description:
            "在一个页面添加图钉后继续浏览，最后只需完成一次。Pinar 会在离开页面前捕获每个图钉，跨页面保持连续编号，并在没有批次槽位的情况下将整个过程保存为一个会话。",
        },
        "unified-session-review": {
          title: "一起审阅所有画面和图钉",
          description:
            "多页面会话在一个支持平移缩放的查看器中打开，所有注释都列在侧栏。Tab 审阅当前捕获，Esc 隐藏工具栏，已保存的会话保留在查看器中查看。",
        },
        "founder-retired": {
          title: "Founder 新购方案已下线",
          description:
            "新购买现在仅提供 Free 和 Pro。由于目前没有 Founder 订阅者，迁移会移除该方案；如果发现任何意外的 Founder 账户、购买、授权、捕获或有效预留，则会停止并要求显式处理。",
        },
        "element-structure": {
          title: "每个元素图钉都有结构",
          description:
            "每个元素图钉会保存其 HTML 树、非默认的计算样式、字体、图标和周围元素。查看器在“结构”下显示，并随 pinar-visual-context 代码块一起传递。",
        },
        "technical-evidence": {
          title: "技术证据",
          description:
            "添加图钉时观察到的控制台错误、失败的请求和环境会随图钉列出，标为“交互之后”或“同一页面”。不做任何推断，也不消耗 Pinar Cloud 积分。",
        },
        "pin-diagnosis": {
          title: "在 Pinar Cloud 中诊断图钉（3 积分）",
          description:
            "AI 会根据图钉的结构解释可能原因，并提出带置信度的 CSS 修复。可接受、编辑或丢弃；只有已接受的诊断会随图钉保留。",
        },
        "save-as-component": {
          title: "在 Pinar Cloud 中将图钉保存为组件（10 积分）",
          description:
            "把捕获的元素转换为 HTML + CSS、React + Tailwind 或 Preact + htm，包含文件、依赖、保真度说明、预览、ZIP 下载和 StackBlitz。",
        },
        "step-recording": {
          title: "录制并整理复现步骤",
          description:
            "在页面上按 G 即可录制点击、输入、滚动和导航。重新打开 Pinar，钉住并复制即可附上时间线；再按 G 则丢弃。查看器会把录制内容转换为供本地智能体使用的简洁文字步骤。",
        },
        "collection-design-system": {
          title: "在 Pinar Cloud 中生成集合的设计系统（15 积分）",
          description:
            "从集合的图钉中提取共有的颜色、排版、间距、圆角和阴影。可导出为 CSS 变量、Tailwind 主题、W3C 令牌或 DESIGN.md。",
        },
        "windows-tray-icon": {
          title: "清晰的 Windows 托盘图标",
          description:
            "通知区域图标会按显示缩放所要求的尺寸渲染，因此在 125%、150% 或 200% 下不再模糊。",
        },
      },
    },
    "v0.3.6": {
      title: "菜单栏更新检查现在可见",
      summary:
        "菜单栏应用会显示“正在检查更新”“已是最新”或“检查更新失败”，各带 10 秒倒计时后回到“检查更新”。",
      changes: {
        "tray-update-status": {
          title: "托盘中的更新检查状态",
          description:
            "“检查更新”在运行时显示“正在检查更新”。如果已是最新，会显示“已是最新 (10s)”。如果失败，会显示“检查更新失败 (10s)”。两者倒计时结束后回到“检查更新”。倒计时期间再次点击会重新检查。",
        },
      },
    },
    "v0.3.5": {
      title: "账户选项卡、一次性套餐仅 Founder、更快完成复制",
      summary:
        "扩展的账户选项卡是一行代码条。一次性套餐只有 Founder。捕获会在注释就绪后立即复制，Alt+Enter 与 Ctrl+Enter 相同。",
      changes: {
        "account-tab-options": {
          title: "账户选项卡代码条",
          description:
            "Free 安装用一行图标生成临时代码，倒计时显示在字段下方。付费账户显示邮箱和套餐；退出为描边按钮；管理订阅仅限 Pro。",
        },
        "lifetime-folded-into-founder": {
          title: "Lifetime 即为 Founder",
          description:
            "一次性套餐只有 Pinar Founder。结账仍接受旧的 lifetime_founder 元数据。没有 Lifetime 标签、环境变量或 Stripe Price 别名。",
        },
        "capture-copy-sooner": {
          title: "先复制再保存截图",
          description:
            "Ctrl+Enter、Command+Enter 或 Alt+Enter 会先复制注释和定位信息，同时助手仍在保存截图。粘贴已就绪后，进度不会停在 80%。",
        },
      },
    },
    "v0.3.4": {
      title: "继续即接受现行政策",
      summary:
        "在「套餐」页付款或验证账户验证码，即表示接受当前条款、隐私政策和可接受使用。没有额外对话框。",
      changes: {
        "checkout-policy-acceptance": {
          title: "付款即表示同意",
          description:
            "在「套餐」页开始付费结账会记录当前条款、隐私政策和可接受使用。额外的确认对话框已取消。",
        },
        "sign-in-policy-acceptance": {
          title: "登录即表示同意",
          description:
            "验证账户邮箱验证码会记录相同的现行政策。额外的接受步骤已取消。远程 Free 仍在扩展选项中接受。",
        },
      },
    },
    "v0.3.3": {
      title: "本地账户菜单与不含 AI 的 Free",
      summary:
        "本地工作区使用与 Free 相同的账户弹出菜单。主页在该菜单中，Free 不再包含 AI 积分或摘要。",
      changes: {
        "local-account-menu": {
          title: "本地账户菜单",
          description:
            "本地工作区页脚现在打开与 Free 相同的账户弹出菜单。主页在菜单内。本地没有可退出的云会话，因此不显示退出。",
        },
        "free-without-ai": {
          title: "Free 不含 AI",
          description:
            "Free 不再发放 AI 积分，也不再显示 AI 摘要。摘要仍属于 Pro、Founder 和 Lifetime。套餐与帮助文案与此限制一致。",
        },
      },
    },
    "v0.3.2": {
      title: "完整的 Windows 安装包",
      summary:
        "Windows 下载现为完整的 Setup ZIP。解压后运行 .installer 文件夹旁边的 Pinar-Setup.exe。",
      changes: {
        "windows-setup-zip": {
          title: "完整的 Windows Setup ZIP",
          description:
            "GitHub Releases 现在发布 win-x64-Pinar-Setup.zip，内含 Pinar-Setup.exe 与 .installer 载荷。1.2 MB 的残缺 exe 已不再列出，因为它无法单独完成安装。",
        },
        "windows-help-links": {
          title: "Windows 安装链接",
          description:
            "帮助和选项会下载该 ZIP。解压后请将 .installer 文件夹留在 Pinar-Setup.exe 旁边；若 Windows 显示 SmartScreen，请打开更多信息并选择仍要运行。",
        },
      },
    },
    "v0.3.1": {
      title: "Windows 应用与独立帮助封面",
      summary:
        "从 Windows 通知区域运行 Pinar，下载 Setup 安装程序，并打开各有独立封面的帮助文章。",
      changes: {
        "windows-desktop-app": {
          title: "Windows 桌面应用",
          description:
            "Pinar 现已提供 Windows 托盘应用。下载 win-x64-Pinar-Setup.exe，运行安装程序，并从通知区域启动本地助手——与 macOS 相同的本地捕获流程。",
        },
        "unique-help-covers": {
          title: "独立帮助封面",
          description:
            "27 篇帮助文章现在各有独立封面图，安装、首次捕获、快捷键和账单等指南不再共用同一张截图。",
        },
        "windows-first-run-help": {
          title: "Windows 首次运行帮助",
          description:
            "安装指南现在说明如何越过首次运行的 SmartScreen 拦截：打开“更多信息”，然后选择“仍要运行”。",
        },
      },
    },
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
