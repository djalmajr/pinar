import type { HelpLocale } from "../help-content";

const locale = {
  ui: {
    articlesFound: "{count, plural, other {找到 # 篇文章}}",
    articleGuide: "本指南内容",
    articleNotFound: "未找到文章",
    articleNotFoundDescription: "该文章不存在。",
    backToHelp: "返回帮助中心",
    breadcrumb: "面包屑导航",
    categories: "分类",
    categoryArticles: "篇文章",
    categoryNotFound: "未找到分类",
    categoryNotFoundDescription: "该分类不存在。",
    explore: "浏览",
    help: "帮助",
    helpCategories: "帮助分类",
    helpNavigation: "帮助导航",
    homeDescription: "基于项目文档、交付记录以及实际已实现行为整理的指引。",
    homeHeading: "需要什么帮助？",
    homeMetaDescription: "了解如何用 Pinar 捕获、整理、分享并审阅视觉反馈。",
    homeMetaTitle: "Pinar 帮助中心",
    minutes: "分钟",
    noArticlesFound: "未找到文章。",
    notFoundDescription: "请使用帮助中心查找已发布的指引。",
    onThisPage: "本页内容",
    openScreenshot: "以完整尺寸打开截图",
    pageTitleSuffix: "Pinar 帮助",
    popularArticles: "常用文章",
    popularDescription: "开始并完成一次审阅最常用的路径。",
    searchLabel: "搜索帮助中心",
    searchPlaceholder: "搜索捕获、智能体、套餐…",
    searchResults: "搜索结果",
    seeAllCategory: "查看该分类全部内容",
    stillNeedContext: "还需要更多背景？",
    visualExample: "示意图：",
  },
  categories: {
    "getting-started": {
      title: "快速开始",
      description: "安装 Pinar，完成第一次捕获，并选择工作保存在哪里。",
    },
    captures: {
      title: "捕获与图钉",
      description: "精确选择页面、添加标注、遮盖敏感区域，并重新打开结果。",
    },
    agents: {
      title: "AI 智能体",
      description: "把视觉上下文发给编码智能体，并安全地闭环审阅。",
    },
    workspace: {
      title: "项目与集合",
      description: "整理、搜索、移动、分享并审阅捕获会话。",
    },
    cloud: {
      title: "云与套餐",
      description: "了解账户、套餐、积分、存储、保留期以及公开分享。",
    },
    privacy: {
      title: "隐私与数据",
      description: "了解 Pinar 存储什么、删除什么，以及哪些控制权仍在您手中。",
    },
  },
  screenshots: {
    "sign-in-extension": {
      alt: "Pinar 登录界面，已选中浏览器扩展配对码流程。",
      caption:
        "扩展流程会接受 Pinar 显示的临时配对码，无需密码即可连接该浏览器。",
    },
    "capture-workspace": {
      alt: "Pinar 工作区，包含带标注的会话卡片、图钉数量、项目、集合、搜索和账户控件。",
      caption:
        "工作区把已捕获页面、图钉数量、项目、集合、搜索和账户状态集中在同一个操作视图中。",
    },
    "getting-started": {
      alt: "Pinar 公开落地页，展示本地优先工作流、工作区入口和套餐导航。",
      caption:
        "从公开的 Pinar 入口开始，打开本地工作区、了解捕获流程，或比较云套餐。",
    },
    "help-navigation": {
      alt: "Pinar 帮助文章，包含分类导航、相关文章链接、结构化章节和页内导航。",
      caption: "帮助页面会同时展示分类、相邻步骤、文章章节和恢复路径。",
    },
    privacy: {
      alt: "Pinar 法律中心，包含条款、隐私、可接受使用、数据保留、退款、Fair Source 和子处理方文档。",
      caption:
        "法律中心把数据、保留、可接受使用、退款、许可和子处理方规则放在同一处可审计的位置。",
    },
    "workspace-table": {
      alt: "Pinar 工作区表格，包含搜索、筛选、图钉数量、创建日期、分页和行操作。",
      caption:
        "表格视图把搜索、筛选、图钉数量、日期、分页和会话操作放进便于扫读的工作流。",
    },
    "sign-in-email": {
      alt: "Pinar 账户登录界面，已选中邮箱验证码流程。",
      caption: "已注册账户会通过邮箱申请短时验证码，并在同一登录界面完成验证。",
    },
    pricing: {
      alt: "Pinar 定价页，比较 Free、Pro 年付、Founder、存储加购和 AI 积分选项。",
      caption: "定价页在结账前展示套餐限额、计费周期、存储加购和 AI 积分购买。",
    },
    updates: {
      alt: "Pinar 版本详情，显示发布日期、版本号、更新内容以及上一篇和下一篇版本导航。",
      caption: "已发布的更新说明让已安装行为和运维变更可以按版本追溯。",
    },
  },
  articles: {
    "install-pinar": {
      title: "安装 Pinar",
      summary: "添加官方 Chrome 扩展，并连接您平台上受支持的本地产品。",
      sections: [
        {
          heading: "浏览器扩展",
          paragraphs: [
            "从 Chrome Web Store 安装 Pinar。这是官方的浏览器安装路径；日常使用不需要 GitHub checkout 或未打包的扩展文件夹。",
          ],
          bullets: [
            "在 Chrome 的扩展菜单中固定 Pinar 图标，让它保持可见。",
            "该扩展支持已发布的 pinar.dev 源以及本地 Pinar 服务器。",
          ],
        },
        {
          heading: "本地产品",
          paragraphs: [
            "在 macOS 上，Pinar.app 位于菜单栏，运行内置 helper、注册受支持的智能体钩子，并检查 GitHub Releases 中的更新。Windows 和 Linux 目前使用独立的 helper 安装程序，而不是桌面应用。",
          ],
          bullets: [
            "截图通常位于 `~/.pinar/shots`，历史位于 `~/.pinar/history.db`。托盘应用的「打开文件夹」操作会打开该目录；PINAR_HOME 可以覆盖它。",
            "helper 会扫描 127.0.0.1 上的端口 17373 到 17382，并通过 GET `/api/health` 识别 Pinar。PINAR_PORT 会把发现固定到单一端口。",
            "「登录时启动」在 macOS 上使用用户级 LaunchAgent。Pinar 在较旧系统上会回退到旧的 launchctl 路径，并把日志保留在 Pinar 主目录下。",
            "如果本地 helper 不可用，图像裁剪会回退到 Downloads/pinar。",
          ],
        },
        {
          heading: "确认 helper 并打开工作区",
          paragraphs: [
            "固定扩展后，按文档中的一次性安装路径安装对应的本地产品：把 macOS 磁盘映像拖到 ~/Applications，在 Windows 上运行 PowerShell 安装程序，或在 Linux 上运行 curl 安装程序。这些脚本会把 helper 放到 ~/.pinar/bin（或 %USERPROFILE%\\.pinar\\bin），将该目录加入 PATH，并运行 pinar install-hooks，以便编码智能体接收粘贴的捕获。",
            "在 macOS 上，Pinar.app 会隐藏 Dock 图标，通过 ~/.pinar/tray.pid 保持单一托盘实例，并在 GET `/api/health` 尚未返回 ok true 和 service pinar 时用 pinar ensure 启动 helper。状态为 Off 时，使用菜单栏的「启动」或「重新启动」，然后「打开工作区」以加载 http://127.0.0.1:<port>/app。如果某个智能体不再显示粘贴说明，请从 helper 重新运行 pinar install-hooks。",
          ],
          bullets: [
            "Windows 安装：irm https://pinar.dev/install.ps1 | iex。Linux 安装：curl -fsSL https://pinar.dev/install.sh | sh。脚本需要 curl 或 wget 来下载二进制文件。",
            "健康的 helper 会以 ok true 和 service pinar 响应 GET `/api/health`。在 macOS 上，「打开工作区」会使用发现到的端口打开 /app 工作区路径。",
            "Chrome 扩展无法自行写入 `~/.pinar/shots`。如果裁剪没有进入该文件夹，请先启动本地产品，然后再捕获一次。",
          ],
        },
      ],
    },
    "first-capture": {
      title: "完成第一次捕获",
      summary:
        "为可见元素或区域添加图钉、写下反馈，并复制一份互相关联的数据包。",
      sections: [
        {
          heading: "在页面上添加图钉",
          paragraphs: [
            "打开页面，选择 Pinar 扩展，然后点击一个元素或拖出一个自由区域。写下评论并按 Enter 添加图钉。",
          ],
          bullets: [
            "重复选择即可在同一次捕获中放置多个带编号的图钉。",
            "Shift+Enter 会换行；Escape 会关闭草稿，但不会删除其他图钉。",
          ],
        },
        {
          heading: "复制数据包",
          paragraphs: [
            "在 macOS 上按 Command+Enter，在其他系统上按 Ctrl+Enter。Pinar 会复制人类可读的 Markdown、HTML，以及指向同一截图和图钉身份的 pinar-visual-context JSON 代码块。",
          ],
        },
        {
          heading: "完成复制并保留身份",
          paragraphs: [
            "只有在至少一个图钉已有评论后，Command/Ctrl+Enter 才会复制。叠加层会显示 Copying…，为截图隐藏图钉装饰，然后显示 Copied，工具栏随之关闭。之后再点击扩展图标只会显示或隐藏叠加层，不会删除已放置的图钉。如果所有剪贴板路径都失败，叠加层会恢复，以便重试。",
            "把剪贴板内容当作一个整体：可读说明、可选的查看器 URL，以及带围栏的 pinar-visual-context JSON 代码块，其中包含 `captureId`、`pinId`、页面 URL、定位器（cssSelector、domPath、innerText），以及 helper 存文件后的截图 URL。图像上的编号徽章是标注叠加，不是页面 UI。粘贴给智能体时不要改写 `captureId` 或 `pinId`。若存在 Screenshot: /path/to/file.png 这一行，它就是包含所有图钉的那一张裁剪图。",
          ],
          bullets: [
            "空的撰写框或没有任何图钉的捕获会中止复制，并闪现 Write a comment first 或 Add a pin first。",
            "降级复制仍会粘贴评论和定位器，但工具栏可能在 Copied 之后附加 no screenshot、helper unavailable 或 no viewer。",
            "尽量让 helper 保持运行，这样 PNG 裁剪会落入 `~/.pinar/shots`，数据包也可以包含用于完整上下文的 /v/<id>.md 查看器链接。",
          ],
        },
      ],
    },
    "local-or-cloud": {
      title: "选择本地或云存储",
      summary: "离线使用本地工作区，或连接账户以获得托管的云存储和分享。",
      sections: [
        {
          heading: "本地",
          paragraphs: [
            "本地模式把历史保存在 SQLite 中，把截图保存在您的机器上。回环 API 只接受受信任的本地或扩展源，并使用受文件系统保护的能力令牌。",
          ],
        },
        {
          heading: "云",
          paragraphs: [
            "云模式把账户数据存在 D1，把截图存在 R2。它可以实现远程工作区访问、托管保留期、AI 摘要、计费以及未列出的分享链接。远程持久化前必须完成法律同意。",
          ],
        },
        {
          heading: "本地和云会话实际如何打开",
          paragraphs: [
            "本地历史始终属于 owner local。首次使用时，数据库会创建受保护的 Personal 项目和受保护的 Inbox 集合，它们不能像用户创建的项目那样被嵌套或删除。已保存的捕获会标记 isPermanent true 且 plan free，PNG 文件写入 Pinar 主目录的 shots 目录，回环 API 通过 /shots/<id>.png 和 /v/<id>.md 呈现它们。变更该 API 需要 ~/.pinar/local-capability.json 中的能力密钥，以 x-pinar-capability 或 Authorization Bearer 令牌发送。该文件以 mode 0600 写入；轮换会让旧密钥在 24 小时内保持有效，除非 PINAR_CAPABILITY_GRACE_MS 另有规定。",
            "在接受当前条款、隐私和可接受使用版本之前，云持久化会被阻止；API 返回 HTTP 428，code 为 legal_acceptance_required。随后远程 Free 会注册一次安装，并可签发五分钟、一次性配对码以打开 /app。付费或曾经付费的账户也可以验证六位数邮箱验证码。浏览器 cookie 有效期为 30 天；已认证的扩展设备有效期为 180 天。未列出的 Markdown 在 /v/、/p/ 和 /c/ 保持公开，截图在 /shots/ 保持公开。",
          ],
          bullets: [
            "本地 GET /api/local/capability 会返回当前令牌；轮换和撤销是同一 /api/local/capability 前缀上的 POST 端点。",
            "SQLite 位于 Pinar 主目录中的 `history.db`；如果 SQLite 无法打开，历史会回退到同一主目录中的 `history.json`。",
            "云分享链接不需要工作区会话：任何持有未列出 URL 的人都可以在 /v/、/p/、/c/ 或 /shots/ 读取 Markdown 或 PNG。",
          ],
        },
      ],
    },
    "shortcuts-and-navigation": {
      title: "键盘快捷键",
      summary: "无需离开键盘即可捕获、在 DOM 中移动、遮盖内容并复制。",
      sections: [
        {
          heading: "捕获过程中",
          paragraphs: [
            "Pinar 只拦截处于活动捕获状态的快捷键，因此宿主页面不会收到同一次按键。",
          ],
          bullets: [
            "Enter 会钉住悬停的元素；Arrow Up 选择其父级，Arrow Down 返回子级。",
            "M 切换隐私遮罩绘制。Escape 取消草稿或遮罩；若没有草稿，则会清除图钉并隐藏工具栏。",
            "Command/Ctrl+Enter 复制已完成的数据包。",
            "Alt+Shift+P 显示或隐藏工具栏而不取消会话，可在 `chrome://extensions/shortcuts` 中重新绑定。浏览器快捷键在 `chrome://` 页面、Chrome 网上应用店以及覆盖层注入之前不会生效。",
          ],
        },
        {
          heading: "焦点密集的页面",
          paragraphs: [
            "在有强焦点陷阱的网站上，Pinar 会有限次数地重试聚焦评论撰写框，然后停止，以免冻结标签页。如果页面不断抢走焦点，请直接点击撰写框。",
          ],
        },
        {
          heading: "叠加层、图标和 DOM 遍历细节",
          paragraphs: [
            "只有叠加层处于活动状态时，捕获快捷键才归 Pinar 所有。扩展图标会切换该叠加层，但不会删除图钉。在没有打开草稿时悬停工具栏会让它穿透，以便您仍可点击或拖动下方页面。Shift+Enter 在撰写框中插入换行，在那里输入的宿主页面快捷键也不会离开评论字段。",
            "Arrow Up 会走到父元素并记住您离开的子节点，因此当它仍是子级时 Arrow Down 会回到该记住的节点；否则使用第一个子节点。在遮罩模式下，拖出一个区域即可隐藏它，点击已有遮罩即可恢复。文档上的键盘滚动仍然有效，但针对已聚焦页面控件的按键会被拦截，以免激活按钮或向宿主表单输入。",
          ],
          bullets: [
            "Command/Ctrl+Enter 会先保存打开的草稿，再复制；没有评论时会显示 Write a comment first，而不是发送空图钉。",
            "Escape 或复制之后，Pinar 会通过 keyup 继续占有该物理按键，以免宿主页面把同一次按键当成自己的取消或提交。",
            "区域图钉只有在指针移动大约六个像素后才开始；更短的点击仍会钉住悬停元素，而不是打开自由矩形。",
          ],
        },
      ],
    },
    "capture-types": {
      title: "元素、区域、整页和 iframe 捕获",
      summary: "选择仍能保留审阅者所需上下文的最小捕获模式。",
      sections: [
        {
          heading: "选择模式",
          paragraphs: [
            "元素捕获记录稳健的 DOM 指纹和精确框。当没有单个元素能代表反馈时，区域捕获覆盖自由矩形。整页捕获会滚动并拼接文档。iframe 捕获会保留 frame 边界和偏移。",
          ],
          bullets: [
            "当智能体必须精确识别代码归属时，优先使用元素。",
            "当视觉关系跨越多个元素时，优先使用区域。",
          ],
        },
        {
          heading: "点击、拖动和 frame 定位",
          paragraphs: [
            "点击节点，或在当前轮廓上按 Enter，即可打开元素图钉。拖出至少六个像素的矩形则会打开区域图钉。对 iframe 或 frame 元素的第一次按下会被忽略，以便该 frame 内的文档接受选择。",
            "元素图钉会记录指纹、选择器和用 frame 边界分隔符连接祖先 frame 的 DOM 路径。区域图钉存储矩形和像素尺寸标签，没有定位器。复制的截图仍会围绕所有图钉的并集拼贴，包括放在子 frame 中的图钉。",
          ],
          bullets: [
            "捕获工具栏留在顶层 frame；子 frame 只显示标记和评论撰写框。",
            "如果父 frame 不回复其路径，图钉只保留内部文档路径。",
            "固定或粘性元素会标记为视口锚定，这样重新打开时不会把它们当成随文档滚动的框。",
          ],
        },
      ],
    },
    "pins-and-comments": {
      title: "图钉、评论和颜色",
      summary: "把带编号的图钉当作截图、文字和结构化上下文之间的稳定引用。",
      sections: [
        {
          heading: "同一次共享捕获",
          paragraphs: [
            "截图上的每个编号徽章都对应一条评论和一条图钉记录。轮换色板把邻近标记区分开，但不会改变它们的身份。",
          ],
        },
        {
          heading: "保持关联",
          paragraphs: [
            "把数据包交给其他工具时，不要改写 `captureId` 或 `pinId`。这些字段让工作区、查看器、智能体结果和审阅历史指向同一次捕获。",
          ],
        },
        {
          heading: "编号和身份如何分配",
          paragraphs: [
            "只有在评论去空白且非空之后，图钉才会保存。新图钉会获得一个 UUID、按其在捕获中的顺序从 1 开始的编号，以及该编号对应的十一色色板中的颜色。因此邻近徽章在视觉上不同，但身份不变。",
            "结构化上下文会沿用现有 `pinId` 或 id 中的 `pinId`。若这些字段缺失，解析器会从捕获身份和图钉编号合成 `captureId`:pN。下游工具随后可以指向同一截图、评论和审阅行。",
          ],
          bullets: [
            "空的撰写框无法复制；焦点会留在该字段，直到存在评论。",
            "悬停标记会在实时页面上预览其编号、评论和当前定位器置信度。",
            "编辑已有图钉只会更新评论；存储的 id 保持不变。",
          ],
        },
      ],
    },
    "full-page-capture": {
      title: "捕获整页",
      summary: "在 Pinar 控制滚动、缩放和重复固定内容的同时，生成一张长截图。",
      sections: [
        {
          heading: "拼接如何工作",
          paragraphs: [
            "Pinar 会规划视口帧、滚动文档、临时抑制重复的粘性或固定元素、按设备像素比渲染，然后恢复页面。",
          ],
        },
        {
          heading: "结果何时会不同",
          paragraphs: [
            "懒加载内容、动画布局、跨源 frame，以及滚动时发生变化的页面，可能产生空隙或未解析区域。让页面稳定后再试，或单独捕获受影响的区域。",
          ],
        },
        {
          heading: "视口图块与布局恢复",
          paragraphs: [
            "Pinar 根据图钉边界并集加上内边距规划滚动位置，然后通过标签页截图 API 捕获每个视口高度的 PNG 图块。后续图块会短暂等待以便页面绘制，合成画布使用从第一块宽度与 CSS 视口推断出的设备像素比。",
            "在第一块之前，粘性和固定节点会被改写，以免在每一帧重复出现。即使合成失败，原始内联样式和滚动位置也会恢复。裁剪图像前，图钉和遮罩坐标会平移到捕获原点。",
          ],
          bullets: [
            "固定节点会变成按测量框绝对定位，并清除变换，以免截图把它们偏移两次。",
            "在捕获过程中，粘性节点会变成相对定位。",
            "图块滚动使用即时 scroll-behavior，因此文档不会在帧之间做动画。",
          ],
        },
      ],
    },
    "smart-selection": {
      title: "智能定位器与 DOM 选择",
      summary:
        "了解页面变化后图钉如何跟随元素，以及 Pinar 何时会要求手动放置。",
      sections: [
        {
          heading: "稳健指纹",
          paragraphs: [
            "元素图钉会组合稳定选择器、DOM 路径、标签、id、name、测试 id、role、类名、文本、标签和几何信息。重新打开时，Pinar 会评估选择器、结构、语义和几何，而不是只信任一条脆弱路径。",
          ],
        },
        {
          heading: "置信度与歧义",
          paragraphs: [
            "匹配可以是精确、可能、歧义或未解析。当两个候选项过于相似时，Pinar 会保留备选，而不是把图钉吸附到错误元素。跨源 iframe 目标可能保持未解析。",
          ],
        },
        {
          heading: "选择器回退与竞争匹配",
          paragraphs: [
            "捕获时，Pinar 优先使用能通过 id、data-testid 或 data-test，或标签加 name 唯一匹配节点的选择器。如果这些都不唯一，它会改为存储结构化 CSS 路径。看起来像生成的类名会从指纹中去掉，以免哈希后的 CSS 模块成为唯一信号。",
            "重新打开时，来自稳定选择器、结构、语义和几何策略的候选项会合并并排序。精确置信度需要高分的稳定选择器或结构命中；语义和几何匹配保持为可能。当前两个可行分数相差不到很窄的边距时，结果为歧义，不会选定任何元素。",
          ],
          bullets: [
            "当其他节点共享相同标签、文本和类名时，位置性 :nth-of-type 选择器得分更低。",
            "区域图钉在作为元素目标时会被拒绝，并在定位器评分期间保持未解析。",
            "当 iframe 的 contentDocument 不可读时，重定位会以 cross-origin-frame 警告停止，而不是猜测。",
          ],
        },
      ],
    },
    "privacy-masks": {
      title: "遮盖敏感区域",
      summary: "在截图序列化或上传之前，把视觉区域涂黑。",
      sections: [
        {
          heading: "绘制遮罩",
          paragraphs: [
            "在捕获模式处于活动状态时按 M，然后在敏感区域上拖动。用户遮罩会在存储前应用到捕获图像；复制前请去掉误画的遮罩。",
          ],
        },
        {
          heading: "遮罩补充脱敏",
          paragraphs: [
            "自动脱敏处理已知的敏感 DOM 字段和 URL 部分。手动遮罩覆盖软件无法可靠分类的视觉内容，例如图表、头像或画布渲染的数据。",
          ],
        },
        {
          heading: "遮罩如何进入存储图像",
          paragraphs: [
            "评论草稿打开时无法绘制遮罩。符合条件的拖动会以文档坐标存储用户遮罩，以便跟随页面滚动；点击该叠加即可移除。复制前，隐私扫描得到的自动字段框会与这些用户矩形合并。",
            "合并后的区域随捕获消息一起传递，因此会在剪贴板或存储之前绘制到截图上。单独的脱敏仍会从 URL、字段值和图钉文本中去除已知密钥；遮罩覆盖那些字符串规则无法分类的像素。",
          ],
          bullets: [
            "用户遮罩使用唯一 id 和 manual 类别，因此可以独立于自动框删除。",
            "自动字段遮罩会被关闭而不是删除，以便后续扫描仍能报告底层字段。",
            "Escape 会离开遮罩绘制，但不会丢弃已经放在页面上的图钉。",
          ],
        },
      ],
    },
    "copy-and-reopen": {
      title: "复制、查看并重新打开捕获",
      summary: "从实时页面转到工作区再返回，而不丢失原始锚点。",
      sections: [
        {
          heading: "查看器控件",
          paragraphs: [
            "捕获查看器支持指针平移、以光标为锚的滚轮缩放、双击缩放，以及 50% 到 800% 的控件。选择图钉会打开渲染后的 Preview 和逐字 Raw Markdown 标签。",
          ],
          bullets: [
            "从查看器下载截图或复制会话 Markdown。",
            "在分享可用时，从查看器操作菜单在 ChatGPT 或 Claude 中打开公开 Markdown。",
          ],
        },
        {
          heading: "在原始页面上审阅",
          paragraphs: [
            "「在页面上审阅」会打开捕获的源并重新水合图钉。Pinar 会拒绝源不匹配，保留每条历史锚点和框，记录重定位历史，并允许您手动重新放置未解析的图钉。",
          ],
        },
        {
          heading: "从查看器复制以及重新打开门控",
          paragraphs: [
            "查看器中的「复制页面」会写入与实时页面相同的关联 Markdown 数据包，交接模式取自已保存偏好中的 compact 或 full，`captureId` 会回退到会话 id。操作菜单会打开 /v/{id}.md 的公开 Markdown，或启动 ChatGPT 或 Claude，并带上指向该 URL 的提示。",
            "「在页面上审阅」会派发带有会话 id 的重新打开事件。helper 仅在来自受信任的 Pinar 应用 URL，且该 id 匹配会话 id 或 `captureId`，并且标签页源仍等于捕获页面源时才会水合。把标签页导航离开该源会断开绑定，而不是把图钉注入错误站点。",
          ],
          bullets: [
            "如果没有重新打开结果到达，查看器会显示 helper 缺失提示，而不是无限等待。",
            "无法读取偏好的公开或较旧查看器仍会使用 compact 交接来复制。",
            "仍为 about:blank 的标签页会保持水合绑定；只有不同的源才会断开它。",
          ],
        },
      ],
    },
    "send-to-agent": {
      title: "把视觉上下文发给智能体",
      summary:
        "粘贴完整的 Pinar 数据包，让智能体同时看到评论、目标、几何信息和共享图像。",
      sections: [
        {
          heading: "该粘贴什么",
          paragraphs: [
            "Pinar 会把纯 Markdown 和 HTML 写入剪贴板。文本包含可读标注，外加带围栏的 pinar-visual-context JSON 代码块。请把两者作为整体粘贴；结构化代码块才是机器可读的事实来源。",
          ],
        },
        {
          heading: "截图与警告",
          paragraphs: [
            "如果数据包列出了绝对 Screenshot 路径，本地智能体应打开那一张图像；编号徽章是叠加层。`screenshot_missing`、`helper_unavailable` 或 `viewer_unavailable` 这类警告描述的是降级交付，并不会让评论和 DOM 上下文失效。",
          ],
        },
        {
          heading: "如何把复制的数据包交给智能体",
          paragraphs: [
            "Chrome 扩展从不会向智能体撰写框自动输入。Command/Ctrl+Enter 之后，请自行把剪贴板粘贴到 Cursor、Claude、Codex 或 Grok。文本以实现图钉评论、并把选择器和 DOM 路径当作互补定位器的说明开头，随后是带围栏的 pinar-visual-context JSON 代码块。如果包含 Viewer URL，仅在这些细节不够时再去获取。",
            "把 `captureId` 和 `pinId` 当作身份，而不是可以改写的标签。Visual Context 目前编码 schemaVersion 1；parseVisualCapture 会拒绝缺失的 `captureId`，以及任何不是 1 或旧版 0 的 schemaVersion。只改图钉描述的内容。如果对方从未粘贴，请让他们从 Pinar 再复制一次，而不是凭记忆重建图钉。",
          ],
          bullets: [
            "把整份剪贴板粘贴给智能体；不要重打评论或编造新的 `captureId`。",
            "开始改代码前，确认粘贴的文本仍包含闭合的 pinar-visual-context 围栏。",
            "如果什么都没粘贴，请对方在 Pinar 中按 Command/Ctrl+Enter，并且只实现图钉评论。",
          ],
        },
      ],
    },
    "handoff-formats": {
      title: "交接格式与目标",
      summary:
        "在不改变捕获身份的前提下，选择 compact 或 full 上下文，以及面向特定智能体的呈现方式。",
      sections: [
        {
          heading: "Compact 与 full",
          paragraphs: [
            "Compact 模式会去掉多余的定位器和几何噪声，同时保留关联。Full 模式保留未删减的载荷。另一项偏好决定是否包含截图；关闭后仍会保留元数据、图钉、定位器、审阅和交接，只是避免存储图像。内联图像数据会从文本载荷中剥离，以防提示过大。工作区「设置」对话框会把这些交付偏好与活动后端同步。",
          ],
        },
        {
          heading: "智能体适配器",
          paragraphs: [
            "Pinar 可以为 Claude、Codex、Grok 以及其他受支持的编码智能体目标调整前导说明和 Markdown 形态。底层的 `captureId`、`pinId` 和视觉上下文约定保持不变。",
          ],
        },
        {
          heading: "复制前在扩展选项中选择交付模式",
          paragraphs: [
            "在扩展选项中，开关勾选时会把 handoffMode 设为 full，未勾选时设为 compact。Compact 是存储的默认值，每条有用事实只保留一次：`pinId`、comment、cssSelector、domPath 和 innerText，外加仅用于区域图钉或没有定位器的图钉的 box 或 coords。Full 保留未删减的捕获。两种投影仍会从 JSON 中去掉 data: 截图 URL；内联图像会存为 null URL 并带 screenshot_inline 警告，以便提示保持有界。",
            "点击 Save，让 preferences:set 把 handoffMode 和 `includeScreenshot` 写入活动后端和 chrome.storage.sync。未知的 handoffMode 值会回退到 compact；`includeScreenshot` 默认为 true。适配器目标是 cursor、claude、codex 和 grok：各自会加上自己的前导说明，但 `captureId`、pinIds 和评论保持相同。只要 includeViewer 关闭，copy-viewer-content 开关就会被禁用。",
          ],
          bullets: [
            "设置 compact/full 开关和 `includeScreenshot` 开关，然后在下一次复制前点击 Save。",
            "除非您有意只要元数据、图钉、定位器和交接而不存储图像，否则请保持 `includeScreenshot` 开启。",
            "保存后复制一次，确认每个适配器粘贴仍共享相同的 `captureId` 和 pinIds。",
          ],
        },
      ],
    },
    "closed-loop-review": {
      title: "闭环智能体审阅",
      summary:
        "跟踪智能体改了什么，由人来核实，并且只在需要再次修正时重新打开。",
      sections: [
        {
          heading: "智能体回传",
          paragraphs: [
            "智能体可以把每个图钉报告为已更改、受阻、不适用或未定位，并附带摘要、原因、变更文件、commit 和 pull request。用同一幂等键重复交付是安全的；该键下内容冲突会被拒绝。",
          ],
        },
        {
          heading: "人工核实",
          paragraphs: [
            "changed 结果会把打开或重新打开的图钉移到待确认修正。只有人可以接受修正或重新打开已接受的图钉。智能体不能接受自己的工作，无效状态转换会被拒绝。",
          ],
          bullets: [
            "正常流程：打开 → 待确认修正 → 已接受。",
            "如果核实失败：已接受 → 已重新打开 → 待确认修正。",
          ],
        },
        {
          heading: "记录一次执行并由人接受",
          paragraphs: [
            "向 /api/agent-executions 发送 POST，agent 设为 claude、codex、cursor 或 grok，带上捕获的 `captureId`、8 到 128 个字符且匹配 [A-Za-z0-9_-] 的 idempotencyKey，以及非空的 results 数组。每个结果需要该捕获上已存在的 `pinId`、一个 status，以及最多 2000 个字符的 summary；可选 files 最多 50 条路径，pullRequest 必须是 http(s) URL。同一键下冲突的指纹是 idempotency_conflict（409）。未知 `pinId` 是 pin_not_found（400），且不会回显捕获评论；未知 `captureId` 是 capture_not_found（404）。",
            "人工审阅是另一次 POST 到 /api/sessions/{id}/pins/{`pinId`}/review，action 为 accept 或 reopen。humanActionsForStatus 只在 correction_ready 提供 accept，只在 accepted 提供 reopen；open 和 reopened 不暴露人工操作，任何其他转换都是 invalid_transition（409）。人工 reopen 之后，第二次 changed 执行才是预期的重试。除非您选择加入，否则请关闭 Share anonymous loop metrics：即使 optIn 为 true，评论、URL、选择器和截图也会作为 forbidden_fields 被拒绝。",
          ],
          bullets: [
            "为同一 `captureId` 和 `pinId` 发布 changed 结果，然后确认查看器在您接受前显示 correction_ready。",
            "只有指纹相同时才复用 idempotencyKey；当文件、摘要或状态确实变化时，请签发新键。",
            "如果核实失败，请以人工身份重新打开，发布第二次结果，再次接受，并保留前后两次捕获 id。",
          ],
        },
      ],
    },
    "reopen-and-relocate": {
      title: "重新打开并重定位图钉",
      summary: "即使 DOM 已经变化，也可以在实时页面上审阅实现。",
      sections: [
        {
          heading: "安全水合",
          paragraphs: [
            "Pinar 会打开已保存的页面，并且只有在活动标签页源与捕获完全匹配时才水合。受信任的应用源可以请求重新打开，但不相关的站点不能把会话注入扩展。",
          ],
        },
        {
          heading: "手动修正",
          paragraphs: [
            "如果目标歧义或未解析，请手动重新放置图钉。原始锚点和框在历史中保持冻结，每次自动或手动重定位都会被记录，供日后审阅。",
          ],
        },
        {
          heading: "打开原始 URL 并放置待处理图钉",
          paragraphs: [
            "session:reopen 只接受来自受信任 Pinar 应用源的请求：pinar.dev 或 *.pinar.dev 主机上的 https，或端口 17373 到 17382 的回环 http。helper 会获取 /api/sessions/{id}，并在已保存的页面 URL 打开新标签页。任何其他站点都会收到 untrusted_app。请求的 id 既不匹配 session.id 也不匹配 `captureId` 时是 session_mismatch；没有 page.url 的捕获是 missing_page。加载后，水合会注入每个 frame，并只保留 DOM 路径属于该 frame 的图钉。",
            "只有在标签页源仍匹配捕获时，水合才会继续。导航离开会断开绑定，并显示 This page is not the original capture URL；about:blank 视为短暂状态，不会断开。歧义或未解析的定位器匹配会保持实时框不变，而不是吸附到相似元素。点击待处理图钉，再点击正确元素：选择器、路径和指纹保持冻结，location 变为 exact，证据为 manual-reposition，locationHistory 会追加一条 manual exact 记录。",
          ],
          bullets: [
            "从 Pinar 应用启动「在页面上审阅」，这样只有该会话会在捕获源上水合。",
            "如果叠加层显示 This page is not the original capture URL，请回到捕获源，而不是放置图钉。",
            "对于未解析图钉，点击标记，再点击实时元素，然后确认 locationHistory 增加了一条 manual exact 记录。",
          ],
        },
      ],
    },
    "handoff-troubleshooting": {
      title: "排查复制与交接警告",
      summary: "从剪贴板、helper、截图或查看器失败中恢复，而不丢失标注。",
      sections: [
        {
          heading: "剪贴板恢复",
          paragraphs: [
            "Pinar 首先通过离屏文档使用浏览器剪贴板 API，并在权限或焦点阻止时回退到隐藏文本选择。如果所有复制机制都失败，叠加层会恢复，以便您的图钉和评论仍可编辑。",
          ],
        },
        {
          heading: "降级并不等于失去关联",
          paragraphs: [
            "`screenshot_missing` 表示图像未能持久化。`helper_unavailable` 表示未联系到本地服务。`viewer_unavailable` 表示没有生成查看器 URL。请从评论、DOM 路径、选择器、图钉坐标、`captureId` 和 `pinId` 继续，然后只重试缺失的那一层。",
          ],
        },
        {
          heading: "工具栏报告失败时走一遍复制路径",
          paragraphs: [
            "复制需要已保存的评论和至少一个图钉。工具栏显示 Copying…，隐藏叠加层，捕获截图，然后请离屏文档写入 text/html 和 text/plain。离屏文档先尝试 navigator.clipboard.write，再回退到 copy 事件加 execCommand。如果这次写入不是 ok，内容脚本仍会对返回的纯文本载荷尝试 writePlainText：clipboard.writeText，然后是隐藏 textarea 选择。",
            "当所有复制路径都失败时，页面会发送 overlays:hidden 且 hidden 为 false，闪现 Copy failed，并让图钉保持可编辑。成功复制会显示 Copied，或 Copied 加上 no screenshot、helper unavailable 或 no viewer，然后结束会话。这些后缀对应 `screenshot_missing`、`helper_unavailable` 和 `viewer_unavailable`。screenshot_inline 不属于降级交接警告。没有闭合 pinar-visual-context 围栏的粘贴无法作为 JSON 解析。",
          ],
          bullets: [
            "如果工具栏显示 Write a comment first 或 Add a pin first，请完成该图钉并再次按 Command/Ctrl+Enter。",
            "如果出现 Copy failed，请确认图钉仍在页面上，按提示授予剪贴板权限，然后重试复制。",
            "阅读 Copied 后缀：no screenshot、helper unavailable 和 no viewer 会指出要重试的缺失层，而无需丢弃评论。",
          ],
        },
      ],
    },
    "organize-projects": {
      title: "整理项目和会话",
      summary: "移动捕获而不丢失它们，并让 Personal 保持为受保护的回退。",
      sections: [
        {
          heading: "项目与回退",
          paragraphs: [
            "项目用于分组集合和会话。Personal 是受保护的默认项目，Inbox 是它受保护的集合。删除其他项目会把它的会话提升到回退位置，而不是销毁它们。",
          ],
        },
        {
          heading: "移动与排序",
          paragraphs: [
            "在集合之间拖动会话、重新排序，或对选中集合使用批量「移动到」。在集合中，「向前移动」和「向后移动」会调整已保存的手动顺序。",
          ],
        },
        {
          heading: "确认移动后的会话落点",
          paragraphs: [
            "使用「向前移动」或「向后移动」前，请先打开一个集合。这些项只出现在集合视图中，会在已保存的位置列表里与相邻会话互换，并且在第一行或最后一行时什么也不做。随后仪表板会把完整 id 列表 POST 到 `/api/collections/{id}/sessions/reorder`。未选择集合时，列表按创建日期排序，而不是该已保存顺序。",
            "拖动从卡片或表格行开始，而不是从搜索、复选框或操作菜单（`data-no-dnd`）。如果被拖动的会话已与其他会话一起选中，所有选中的 id 都会一起移动；否则只移动该会话。「移动到」会先询问项目，再询问该项目展平树中的集合；更改项目会清空集合字段，没有集合的项目会被禁用。会话会追加到目标中的下一个位置。删除 Personal 会被拒绝；删除其他项目会按现有顺序把它的会话追加到 Inbox，并移除该项目的集合。",
          ],
          bullets: [
            "先选择一个集合，然后仅在存在相邻项时使用「向前移动」或「向后移动」；第一行不能再向前，最后一行不能再向后。",
            "要移动多个会话，请先选中它们，然后拖动任一选中卡片或打开「移动到」；拖动未选中的卡片只会移动该会话。",
            "删除非 Personal 项目后，打开 Personal / Inbox，并在列表末尾查看追加的会话，然后再重新归档。",
          ],
        },
      ],
    },
    "nested-collections": {
      title: "使用嵌套集合",
      summary: "在每个项目内建立层级，并在重组时不展平子级关系。",
      sections: [
        {
          heading: "集合树",
          paragraphs: [
            "集合可以有父集合和子集合。拖动一个分支会在同一项目树内移动时保留深度和后代关系。环、未知父级以及嵌套到受保护容器下都会被拒绝。删除父级会把它的子集合按现有顺序提升到父级。",
          ],
        },
        {
          heading: "捕获时的目标",
          paragraphs: [
            "扩展可以在保存到云之前指定项目或集合。如果所选目标不再可用，受保护的 Personal/Inbox 回退会让会话仍可访问。",
          ],
        },
        {
          heading: "缩进一个分支，然后核实父级",
          paragraphs: [
            "拖动集合时，水平偏移按 18 像素的缩进步进测量。投影深度会被限制，不能比前一个兄弟深超过一级，也不能比下一个兄弟更浅。把分支放到它自己的后代上会被忽略，树保持原位。受保护集合停留在 depth 0，可排序列表把受保护集合的子项当作根，因此它们不能继续嵌套在该受保护容器下。",
            "在扩展的目标选择器中，`destination:get` 返回 CaptureDestination（`projectId` 和 `collectionId`）以及项目树，嵌套集合按每层深度缩进 16 像素。更改项目会立即保存该项目的受保护集合（若存在），否则保存其第一个集合。如果 `destination:set` 失败，选项页会显示目标不可用错误并重新加载 `destination:get`，以免缺失的集合保持选中。空树会显示禁用的 Inbox 占位符。",
          ],
          bullets: [
            "向右拖动集合以嵌套到前一个兄弟下，或向左拖向根；如果放置被拒绝，parentId 列表保持不变。",
            "只有在需要更短侧栏时才折叠父级；隐藏的后代仍在树中，并仍会随拖动的分支一起移动。",
            "目标保存出错后，请重新打开扩展选项，并在下一次云捕获前确认项目和集合匹配一棵活动树中的条目。",
          ],
        },
      ],
    },
    "find-manage-share": {
      title: "查找、管理和分享会话",
      summary:
        "搜索每个有用字段、筛选审阅工作、批量操作，并且只发布您打算公开的内容。",
      sections: [
        {
          heading: "搜索与视图",
          paragraphs: [
            "搜索会匹配页面标题、URL、描述、图钉评论和 CSS 选择器。图钉数量和审阅状态筛选可以组合。在卡片网格和表格之间切换；表格提供每页 15、30、60 或 100 行，并在本地记住视图。",
          ],
        },
        {
          heading: "批量与分享操作",
          paragraphs: [
            "在任一视图中选择会话，即可一起移动或删除。删除会话是永久的：它会移除截图以及智能体执行、图钉结果、审阅和审阅事件。会话、项目和集合的公开查看器是未列出的，而不是访问控制的；任何持有有效链接的人都可以打开。聚合查看器可以为包含的每个会话复制合并后的 Markdown。",
          ],
        },
        {
          heading: "组合筛选，然后复制公开 Markdown",
          paragraphs: [
            "搜索会去掉首尾空白，并按不区分大小写的子字符串匹配。仅含空白的查询会让每个会话都符合条件，直到图钉数量或审阅状态筛选排除它们。图钉数量复选框是 1、2–5 和 6 或更多这几个桶；会话必须匹配至少一个已选桶。审阅状态筛选对照存储的 reviewCounts；如果这些计数缺失，每个图钉都视为 open。更改搜索、任一筛选、集合或项目都会把分页重置到第一页。",
            "网格全选只作用于当前页的卡片；表格全选使用当前表格页。网格或表格选择存储在 localStorage 的 `pinar-history-view`。批量删除会打开确认对话框，然后对每个选中 id 执行 DELETE `/api/history/{id}`。公开项目或集合查看器会加载 `/api/public/projects/{id}` 或 `/api/public/collections/{id}`，并从 `/p/{id}.md` 或 `/c/{id}.md` 复制合并后的 Markdown。如果该公开获取不是 ok，查看器会显示未找到状态，而不是列表。",
          ],
          bullets: [
            "应用搜索或筛选后，确认分页跳到了第 1 页，以免阅读旧结果集中过期的一页。",
            "仅在复选框匹配您打算操作的会话后，才使用批量工具栏的「移动到」或「删除」；「清除选择」会清空集合，但不会更改存储。",
            "在聚合查看器上，Copy Markdown 应粘贴一个标题、一个 `/p/` 或 `/c/` 查看器 URL，然后每个会话作为一个 `/v/{id}` 标题，包含 Page、Markdown、可选 Screenshot 以及带编号的图钉评论；如果复制失败并显示 Unable to load Markdown，请在浏览器中打开同一个 `.md` URL。",
          ],
        },
      ],
    },
    "account-and-sign-in": {
      title: "账户与无密码登录",
      summary: "连接扩展、打开 Web 工作区，并了解验证码和会话过期。",
      sections: [
        {
          heading: "两种验证码流程",
          paragraphs: [
            "远程 Free 安装可以用五分钟、一次性扩展验证码打开 Web 应用。创建新的八字符验证码会使之前有效的那个失效；生成限制为每个 IP 和账户每五分钟 10 次请求，兑换限制为每个 IP 每五分钟 20 次尝试。付费和曾经付费的账户也可以申请六位数邮箱验证码；它在十分钟后过期，五次无效尝试后锁定。",
          ],
        },
        {
          heading: "会话",
          paragraphs: [
            "Web 会话持续 30 天，已认证的扩展设备持续 180 天。服务器存储验证码和会话令牌的哈希，而不是原始密钥值。",
          ],
        },
        {
          heading: "从扩展的 Account 标签完成配对",
          paragraphs: [
            "在远程 Free 安装上，打开扩展选项的 Account 标签并在那里生成临时验证码，然后复制它。从同一标签打开托管登录页；链接指向 /sign-in 且 returnTo=/app，因此成功兑换后会进入 Web 工作区。重新生成会先要求确认，因为服务器会在插入新的八字符值之前删除该所有者所有未使用的验证码。请把验证码粘贴到 pinar.dev 而不是回环：本地 helper 会把 /sign-in 重定向到托管源，并且自己不会签发云会话。",
            "申请邮箱验证码始终报告 accepted 并带十分钟提示，包括未知地址、未付费账户或邮件服务缺失时，因此该表单不是账户神谕。真正的六位数邮件只会发送给曾经付费的账户；如果投递抛错，该挑战行会被删除。邮箱申请限制为每个 IP 10 次、每个地址每 15 分钟 5 次；验证限制为每个 IP 20 次、每个地址每 15 分钟 10 次。提交验证码以及安装身份会把该远程 Free 工作区迁移到付费账户，并签发 180 天设备令牌。退出登录会撤销 pinar_session cookie 以及同一请求上出示的任何设备 bearer。",
          ],
          bullets: [
            "如果没有收到邮件，请等过 15 分钟的申请窗口再重试；429 表示触及了 IP 或地址限制，而静默的 accepted 响应可能意味着该地址未付费或未知。",
            "在使您仍打算在托管登录页输入的验证码失效之前，请先确认重新生成对话框。",
            "需要立即撤销当前 Web cookie 或扩展设备会话时，请使用 Account 标签上的 Sign out，或 POST /api/auth/logout。",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free、Pro、Founder 与计费",
      summary: "比较产品权益、管理订阅，并把定价页当作当前价格来源。",
      sections: [
        {
          heading: "套餐形态",
          paragraphs: [
            "Free 包含永久本地使用、250 MB 云配额、七天云保留期和五次初始 AI 积分。Pro 按月或按年计费，提供 5 GB 和每月补充的 200 个不结转 AI 积分。Founder 是限量一次性群体，提供 5 GB 和 500 个初始积分；它不包含每月积分补充。",
          ],
        },
        {
          heading: "计费与可用性",
          paragraphs: [
            "地区 BRL 或全球 USD 价格、Founder 可用性以及当前优惠都属于「套餐」页。Stripe Checkout 会为 Founder 名额保留 15 分钟，并在放弃结账时释放。Stripe 客户门户处理套餐变更、取消、支付方式和发票。",
          ],
        },
        {
          heading: "用当前政策和正确货币开始 Checkout",
          paragraphs: [
            "在接受当前条款、隐私政策和可接受使用版本之前，POST /api/stripe/checkout 会拒绝该优惠。Cloudflare 国家为 BR 时选择 BRL 目录和巴西 Stripe Price ID；其他国家使用 USD。Founder 结账会先插入按结账请求 id 和 claim 哈希键控的容量预留，再附加 Stripe session id；创建 Stripe 会话时如果没有可附加的预留，会释放该名额。FOUNDER_SALES_ENABLED 必须为 true 且 FOUNDER_CAPACITY_LIMIT 为正，否则处理程序返回 503；名额已满，或在复用的请求 id 上 claim 不匹配，会返回 409。",
            "成功 URL 带有 session_id 和 claim；激活会把该 claim 与 Stripe metadata 做哈希比对，然后才授予优惠。GET /api/pricing 会把 founderState 公开为 closed、sold_out 或 available，以便「套餐」页隐藏结账会拒绝的群体。计费门户需要已认证且已有 stripeCustomerId 的账户，并返回 /app。当 Pro 计费不再处于活动状态时，该套餐上的会话会在付费资格结束后 90 天获得 retention_expires_at；Founder 和旧版终身账户会把会话标记为永久，而不是进入该过期路径。",
          ],
          bullets: [
            "付款前请在托管「套餐」流程中接受当前政策版本；缺少接受会返回 legal_acceptance_required，而不是 Stripe URL。",
            "如果 Founder 结账返回 409，请重新加载 /api/pricing：closed 或 sold_out 意味着等待已释放的预留或选择 Pro，而不是用新的请求 id 重试同一个 claim。",
            "如果门户返回 401 或 404 No Stripe customer found，请先完成一次已付款的 Checkout 以便存在客户 id，然后从账户会话重新打开「管理订阅」。",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "AI 摘要与积分",
      summary: "了解积分何时被预留、消耗、补充或退还。",
      sections: [
        {
          heading: "摘要费用",
          paragraphs: [
            "会话摘要会在模型推理前预留 100 AI 积分。成功后预留被消耗。失败或中止的推理会立即退还；超过五分钟仍未结算的预留会自动退还。摘要限制为每个账户每分钟 10 次请求、每个 IP 每分钟 30 次；同一会话的重复请求会等待活动请求完成。",
          ],
        },
        {
          heading: "余额",
          paragraphs: [
            "购买的积分包会增加 1,000 积分。Pro 每月 200 积分额度不结转。Founder 的 500 积分是开通余额，不是每月额度。账户菜单显示活动余额和下一次适用的补充日期。",
          ],
        },
        {
          heading: "用新的 request id 重试摘要并阅读账本",
          paragraphs: [
            "POST /api/ai/session-summary 需要唯一的 requestId 以及您拥有的会话。在该会话上复用同一 requestId 会返回已存储的成功载荷，或在推理仍被预留时返回 409 ai_request_in_progress。五分钟预留超时后，用量会作为 reservation_timeout 退还，下一次调用必须使用新的 requestId；超时重试若还不能退还，会返回 503 ai_refund_pending。失败或中止的推理会在可能时立即退还。余额不足返回 402 insufficient_ai_credits 并带上实时余额。缺少 Workers AI 返回 503 ai_unavailable。",
            "授权选择器先花费非购买余额，然后是最快过期的授权，因此会在下个 UTC 月过期的每月包含积分会先于购买包被使用。购买的 1,000 积分包会以 12 个月的 expires_at 存储，该时间戳过后会从余额查询中消失。GET /api/account/entitlements 返回剩余积分合计、nextExpiryAt，以及 Founder 账户和 billing_status 为 active 的 Pro 账户的 nextRefillAt。请求的摘要语言必须是 de、en、es、fr、ja、pt 或 zh；任何其他值都会写成英语。",
          ],
          bullets: [
            "遇到 409 ai_request_in_progress 时，请等待进行中的 requestId 完成，而不是在同一会话上再开一次摘要。",
            "遇到 ai_request_refunded 或 reservation_timeout 时，提交新的 requestId；重放过期 id 不会开始另一次推理。",
            "如果工作区显示积分为零，请调用 /api/account/entitlements，并在购买另一个 1,000 积分优惠前，把 nextExpiryAt 与已购积分包比较。",
          ],
        },
      ],
    },
    "storage-and-retention": {
      title: "存储、保留与恢复",
      summary: "了解配额、即将过期的加购、被阻止的上传以及恢复窗口。",
      sections: [
        {
          heading: "配额与加购",
          paragraphs: [
            "Free 有 250 MB 基础云存储；Pro 和 Founder 有 5 GB。可选的 5 GB 和 20 GB 存储加购持续 12 个月，并在到期前七天和一天发送提醒邮件。截图上传必须是有效 PNG 文件，并在存储前通过原子配额检查。如果结果字节会超过当前配额，上传会暂停。",
          ],
        },
        {
          heading: "权益过期之后",
          paragraphs: [
            "如果即将过期的权益让账户超出配额，Pinar 会给予 30 天宽限期，随后直到第 90 天提供恢复访问。此后，超额数据便有资格被清理。目前尚未启用自动删除，因此资格并不承诺立即删除。",
          ],
        },
        {
          heading: "让替换内容符合配额，并使用 90 天恢复时钟",
          paragraphs: [
            "配额是 `baseBytes` 加上仍然有效的加购字节。`canStoreBytes` 把覆盖视为 `usedBytes` 减去该会话已存储字节再加上传入大小，因此用更小的 PNG 替换更大的 PNG 可能成功，而全新捕获会超出配额。只要 `usedBytes` 已经达到或超过配额，`uploadAllowed` 就是 false。超额但没有 `latestExpiredAt` 时间戳是 over_quota 状态，没有宽限时钟。当 `latestExpiredAt` 来自过期加购或 `paidEligibilityEndedAt` 时，账户在 30 天内处于 grace，到第 90 天可恢复，然后是 cleanup_eligible；这三种状态下上传都保持禁止。",
            "非永久的 Free 云会话在七天后成为可删除。超过 Free 配额的 Pro 内容在付费资格结束后遵循 30 天宽限和 90 天恢复窗口。Founder 和旧版终身内容不会仅仅因为没有经常性订阅就被设为可删除；它仍受已购配额、用户删除、滥用和法律冻结、账户关闭以及服务终止限制。设备上的仅本地历史永远不会被远程删除。删除资格不是立即移除的承诺，托管自动删除被有意关闭。",
          ],
          bullets: [
            "当新捕获暂停时，请通过删除会话或替换过重截图把 `usedBytes` 降到剩余配额以下，或购买 5 GB 或 20 GB 的十二个月加购。",
            "如果权益状态是 grace 或 recoverable，请在 `latestExpiredAt` 之后的第 90 天前导出仍需要的内容；cleanup_eligible 只标记超额，它本身不会删除。",
            "不要指望卸载桌面应用会清除云对象，也不要指望云端会擦除 ~/.pinar 本地历史。",
          ],
        },
      ],
    },
    "sharing-links": {
      title: "分享会话、项目和集合",
      summary: "使用未列出的查看器和 Markdown 投影，并带着正确的隐私预期。",
      sections: [
        {
          heading: "未列出的公开链接",
          paragraphs: [
            "云查看器存在于单个会话、项目或集合。它们对任何持有链接的人公开，并且不会作为常规导航被索引。不要把未列出的 URL 当作敏感内容的身份验证。",
          ],
        },
        {
          heading: "给智能体的 Markdown",
          paragraphs: [
            "会话的 .md 投影包含元数据、截图引用、定位器、智能体结果和审阅历史。项目和集合投影会合并它们的会话。过期或不可用的分享数据会返回未找到响应，而不是私人账户详情。",
          ],
        },
        {
          heading: "复制公开 Markdown 投影并了解它会暴露什么",
          paragraphs: [
            "未列出的 HTML 位于会话的 /v/{id}、项目的 /p/{id} 和集合的 /c/{id}。Markdown 投影是同一路径加上 .md 后缀。聚合查看器会在没有 auth cookie 的情况下加载 /api/public/projects/{id} 或 /api/public/collections/{id}；Copy Markdown 随后 GET /p/{id}.md 或 /c/{id}.md 并把文本写入剪贴板，每个会话卡片打开 /v/{id}。缺失或格式错误的 id 返回 Session not found、Project not found 或 Collection not found，而不是所有者邮箱、套餐或其他账户字段。",
            "会话 Markdown 由交接数据包加上智能体结果和图钉审阅章节构成。项目和集合 Markdown 会列出每个嵌套会话，包含页面 URL、/v/{id}.md、可选截图 URL、图钉评论、`pinId`、DOM 路径、选择器和内部文本。只有所有者的 `includeScreenshot` 交付偏好允许时，才会出现 Screenshot 行。Markdown 和公开 JSON 缓存为 public max-age=60；截图 PNG 缓存 86400 秒。任何能打开链接的人都可以复制所见内容，因此未列出的 URL 不是授权，也不是数据最小化。",
          ],
          bullets: [
            "发送 /p/{id} 或 /c/{id} 之前，请打开一次 Copy Markdown，检查每个嵌套会话、图钉评论和截图行是否可以公开。",
            "如果投影应去掉图像 URL，请在所有者账户上关闭截图交付；至少等待 60 秒让公开 Markdown 缓存过期。",
            "如果分享路径显示未找到，请把该 id 视为已消失或无效；公开处理程序永远不会把私人账户诊断加到该响应中。",
          ],
        },
      ],
    },
    "where-data-lives": {
      title: "您的数据存放在哪里",
      summary: "区分本地文件、云持久化、浏览器偏好和公开投影。",
      sections: [
        {
          heading: "本地边界",
          paragraphs: [
            "本地截图是 `~/.pinar/shots` 下的文件，本地历史是 `~/.pinar/history.db` 下的 SQLite，SQLite 不可用时回退到 JSON。视图、语言、主题和交付设置等浏览器偏好留在本地浏览器存储中，除非某项功能明确同步它们。",
          ],
        },
        {
          heading: "云边界",
          paragraphs: [
            "云账户记录和捕获元数据使用 Cloudflare D1；图像使用 R2。Stripe 处理计费，配置的邮件服务发送登录验证码，Workers AI 处理请求的摘要。「子处理方」页是外部服务角色的当前列表。",
          ],
        },
        {
          heading: "确认每次捕获实际保存在哪个存储中",
          paragraphs: [
            "从 helper 主目录开始，检查哪个文件是活动的。截图作为 PNG 文件写入 shots 文件夹；会话历史优先使用 `history.db` 的 SQLite，只有在 `SqliteHistoryDb` 无法构造后才会打开 `history.json`。成功打开 SQLite 还会把嵌套的 shots/shots 路径前缀改写到规范的 shots 目录。主题仍是仅浏览器偏好：Interface 标签把 dark 或 light 存在 localStorage 键 pinar-theme 下，并在 system 时删除该键。语言以及 Capture 标签中交接模式（full 对 compact）和 include-screenshot 的开关在同一设置对话框中编辑，但已登录的云账户可以通过 GET 和 PATCH /api/preferences 把 handoff_mode 和 include_screenshot 持久化到 D1 owner_preferences。",
            "托管捕获把元数据放在 D1，把 PNG 字节放在 R2。未认证的公开投影是 GET /shots/{id}.png（Cache-Control max-age 86400）、GET /v/{id}.md，以及 /p/ 和 /c/ 项目和集合路由。POST /api/auth/email-codes 只在 email_challenges 中存储哈希，十分钟后使挑战过期，即使 EMAIL 缺失或账户不是 everPaid 也会返回 202 和 { accepted: true, expiresInSeconds: 600 }，因此该响应不会揭示邮件是否已发送（429 是速率限制例外）。请求的摘要会在 POST /api/ai/session-summary 调用 Workers AI 模型 @cf/meta/llama-3.1-8b-instruct-fp8。「子处理方」页把 Cloudflare 用于 D1、R2、Workers AI 和事务邮件，把 Stripe 用于 Checkout，并注明 Pinar 不会收到完整卡号。GET /api/legal/current 报告政策版本 2026-08-25。",
          ],
          bullets: [
            "如果 `history.db` 缺失或 SQLite 打开失败，请把 ~/.pinar/history.json 当作活动的本地目录，并预期出现关于 JSON 回退的控制台警告。",
            '在 /shots/{id}.png 打开托管截图，在 /v/{id}.md 打开其 markdown 投影；缺失的 R2 对象返回 JSON { error: "shot not found" }，状态为 404。',
            "在设置中，通过 pinar-theme 确认 Interface 主题，然后区分 Capture 交付开关与登录后 D1 中云同步的 handoff_mode 和 include_screenshot。",
          ],
        },
      ],
    },
    "automatic-sanitization": {
      title: "自动脱敏",
      summary:
        "了解交接或存储前 Pinar 会移除哪些 URL、DOM、凭据和内联图像数据。",
      sections: [
        {
          heading: "敏感字段与 URL",
          paragraphs: [
            "Pinar 会脱敏 password、payment、token 和 OTP 字段；移除 URL 片段；并剥离已知敏感查询键，例如 access_token、api_key、auth、password、secret、token 和 jwt。您可以在扩展设置中添加更多查询键名称。",
          ],
        },
        {
          heading: "结构化交接",
          paragraphs: [
            "视觉上下文解析器接受受支持的 schema 版本，并脱敏内部解析错误，而不是暴露原始密钥。内联截图数据会从文本交接中移除；数据包改用有界路径或 URL 引用。",
          ],
        },
        {
          heading: "观察脱敏报告和被丢弃的内联图像",
          paragraphs: [
            "sanitizeCapture 会根据 input type、autocomplete 以及 name/id/ariaLabel/role 干草堆对 password、otp、payment 和 token 字段分类，然后脱敏页面 URL。敏感集合中的查询键，或 lookLikeSecret 的值（长度至少 12 且匹配 JWT，或带 sk_live_、ghp_、github_pat_ 和 AIza 等前缀），会被替换为 [redacted] 并标记为 secret-query 或 token；哈希参数使用 secret-hash。extraQueryKeys 和 extraHashKeys 中的额外名称会转小写，按空格、逗号或分号拆分，并与 DEFAULT_SENSITIVE_QUERY_KEYS 取并集，后者还包括 authorization、refresh_token、session、session_id、client_secret、bearer，以及简短概览列表之外的相关名称。收集到的密钥随后会替换 title、description、URL 和图钉中的匹配子字符串。即使字段已分类，短于四个字符的值也不会用作替换密钥；无法解析的 URL 会原样返回。",
            "parseVisualCapture 接受 schemaVersion 1 或旧版 0，并抛出 VisualContextError，带有稳定消息 invalid visual context 以及代码 unsupported_schema、invalid_payload、invalid_pin 或 missing_capture_id，而不是回显原始正文。decodeVisualCaptureJson 在 JSON 或 schema 失败时，会返回带空图钉的该 `captureId`。screenshotFrom 和 captureForHandoffJson 会把 data: URL 的 screenshot.url 设为 null；交接路径在剥离内联字节时会添加警告 screenshot_inline，因此文本数据包保留文件系统路径或 http(s) 引用，而不是图像载荷。把 input.unevaluated 设为 true 会在隐私报告上记录 unevaluated，并添加警告 privacy_unevaluated。",
          ],
          bullets: [
            "sanitizeCapture 之后，请阅读 privacy.redacted 以及警告 privacy_redacted 或 privacy_unevaluated；unevaluated true 表示某些区域未被检查。",
            "以逗号、空格或分号分隔的标记添加额外查询键名称；匹配对内置集合不区分大小写，包括 authorization、session 和 refresh_token。",
            "如果粘贴的交接 JSON 仍包含 data: 截图 URL，说明该捕获跳过了 captureForHandoffJson；受支持路径会把 url 置为 null，并可能添加 screenshot_inline。",
          ],
        },
      ],
    },
    "local-security-and-recovery": {
      title: "本地安全与恢复",
      summary: "了解能力令牌、受信任源、本地迁移以及安全的启动恢复。",
      sections: [
        {
          heading: "本地 API 信任",
          paragraphs: [
            "本地 API 接受回环和已发布的扩展源，然后验证以受限文件权限存储的能力密钥。令牌轮换会让旧密钥在 24 小时内保持有效，以便活动进程采用新值；撤销会删除该文件并强制重新授权。",
          ],
        },
        {
          heading: "安全恢复",
          paragraphs: [
            "过期的托盘 PID 锁会被替换，而活动实例保持不动。停止和重新启动首先使用 helper 的优雅路径；在 macOS 上，只有卡住的监听器在等待后仍保持响应才会被终止。损坏的回退历史 JSON 会重置为带有受保护 Personal 和 Inbox 的空白 schema。嵌套 shots/shots 路径下的旧截图会在不覆盖名称冲突的情况下迁移。",
          ],
        },
        {
          heading: "出示能力密钥并恢复损坏的本地存储",
          paragraphs: [
            'helper 使用 0o600 临时文件和重命名，把 version-1 存储持久化到 local-capability.json。在 x-pinar-capability 标头或 Authorization Bearer 令牌中发送当前密钥。当 Origin 为空、127.0.0.1 / localhost / ::1 上的回环 HTTP，或带字母数字 id 的 chrome-extension:// 时，GET /api/local/capability 可以省略密钥；任何其他 Origin 都是敌对的，会收到 401 { error: "unauthorized" } 以及 Cache-Control no-store。HTTPS 回环不被视为回环。POST /api/local/capability/rotate 和 /revoke 需要匹配的密钥。轮换会写入新的 current 密钥，并保留 previous.secret 直到 expiresAt（默认 24 小时，可用 PINAR_CAPABILITY_GRACE_MS 覆盖；零会丢弃 previous）。撤销会删除该文件；下一次 readOrCreateLocalCapability 会签发新存储。普通回环请求跳过密钥；chrome-extension 请求需要匹配。分类为 public-min 或 local-public-projection 的条目跳过此门控。',
            "claimInstanceLock 会留下活动的外部 PID 并调用 onDuplicate；缺失或不可读的锁被视为过期，并用本进程 id 覆盖。migrateNestedShots 把文件从 shots/shots 移到 shots，并跳过目标处已存在的名称；只有当 conflicts 列表为空时才会删除嵌套目录。截图 id 会被缩减为 A–Z、a–z、0–9、下划线和连字符，最长 80 个字符，否则文件是 pin.png。如果 `SqliteHistoryDb` 抛错，openHistoryDb 会发出警告并打开 `history.json`。损坏的 JSON 文件会解析为空数组，然后 _ensureDefaults 为 owner local 重建受保护的 Personal 项目和 Inbox 集合。失败的 JSON 写入会记录警告，但不会中止启动。当 `history.db` 不存在时，migrateLegacyHistoryDb 可能把 bin/ 或 shots/ 中残留的 history.sqlite 重命名为 `history.db`。",
          ],
          bullets: [
            "在 chrome-extension 调用上发送 x-pinar-capability 或 Bearer；GET /api/local/capability 从回环 HTTP 或 chrome-extension 引导，其他 Origin 收到 401 unauthorized。",
            "撤销后 local-capability.json 消失；下一次 helper 启动会签发新密钥，客户端必须重新读取它，rotate 或 revoke 才能再次成功。",
            "如果 `history.db` 无法打开，请预期 `history.json`；损坏的 JSON 文件会变成空目录，然后为 owner local 创建 Personal 和 Inbox，而不会让 helper 崩溃。",
          ],
        },
      ],
    },
    "telemetry-and-policies": {
      title: "遥测、同意与政策",
      summary:
        "了解哪些是选择加入、哪些政策约束云使用，以及 Fair Source 在这里意味着什么。",
      sections: [
        {
          heading: "闭环指标",
          paragraphs: [
            "除非您选择加入，否则循环指标是关闭的。禁用时，提交会被丢弃。启用时，脱敏器允许运维事件、持续时间、智能体和重定位置信度，但拒绝评论、标题、URL、DOM 路径、选择器、截图、标记和原始内容。",
          ],
        },
        {
          heading: "同意与许可",
          paragraphs: [
            "远程持久化和结账会记录对当前条款、隐私政策和可接受使用政策的接受。保留、退款、Fair Source 和子处理方有单独发布的文档。Pinar 在仓库许可下是 Fair Source/source-available，当前版本不是 OSI 认可的 Open Source。",
          ],
        },
        {
          heading: "核实选择加入载荷和已发布的政策集",
          paragraphs: [
            "循环指标默认关闭，因为 DEFAULT_LOOP_METRICS_OPT_IN 为 false。除非 optIn 严格为 true，否则 planLoopMetricRequest 返回 send false，reason 为 opt_in_off，loopMetricHttpStatus 把该代码映射为 HTTP 200。启用时，每个事件对象只能包含 agent、degraded、durationMs、event 和 locationConfidence。未知键，或 url、title、comment、screenshot、selector、path、`captureId`、sessionId、html、markdown、content、pin 和 page 等禁止键，或看起来像 http(s) URL、data: URI，或包含 { 或 < 的字符串值，都会变成 forbidden_fields（HTTP 400）。event 必须是 accepted、correction_ready、handoff、relocation_failed 或 reopened；agent 必须是 claude、codex、cursor 或 grok；locationConfidence 必须是 exact、probable、ambiguous 或 unresolved；durationMs 必须是不超过 86,400,000 的非负整数。空的或非数组的 events 值是 invalid_payload，不会被发送。",
            "README 声明结账和远程 Free 注册会记录已接受的政策版本，并在 https://pinar.dev/legal/ 发布条款、隐私、可接受使用、保留、退款、Fair Source 和子处理方。legal-documents 把全部七个文档 id 的 CURRENT_LEGAL_VERSION 固定为 2026-08-25。条款写明从未联系托管服务的仅本地使用不需要托管账户；隐私写明从未离开设备的仅本地数据不在托管政策范围内。LICENSE 是 Functional Source License, Version 1.1, MIT Conversion：首次发布两年后 Change License 为 MIT，在 Change Date 之前您不得提供竞争性的商业托管视觉标注、截图预览或云持久化服务。Fair Source 声明服从 LICENSE，并且不是 OSI 认可的 Open Source。问题请发至 contact@pinar.dev 或 contato@pinar.dev。",
          ],
          bullets: [
            "除非您有意把 optIn 设为 true，否则请保持循环指标禁用；禁用计划返回 send false 和 opt_in_off，并且不会传输该批次。",
            "在托管持久化或结账前，从 https://pinar.dev/legal/terms、/privacy 和 /acceptable-use 打开版本 2026-08-25 的条款、隐私和可接受使用。",
            "把 LICENSE 视为 FSL-1.1-MIT 竞争限制和 Change Date 的控制文本；当前点名的托管子处理方是 Cloudflare 和 Stripe。",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
