
import { Language } from './types';

export const translations = {
  en: {
    appTitle: "AI Cine-Director",
    appSubtitle: "Transform your story ideas into consistent, production-ready AI video storyboards.",
    
    // Auth Flow
    oneClickLogin: "One-click Login with Studio ID",
    otherMethods: "Other login methods",
    bindingAccount: "Binding Account...",
    agreeTerms: "I have read and agree to the User Agreement and Privacy Policy",
    detectedAccount: "Detected existing identity",
    bindSocial: "Link Social Account to enter Studio",
    
    // Auth UI
    welcomeBack: "Welcome back, Director",
    startProduction: "Login to start production",
    phonePlaceholder: "Mobile Number or Email", // Updated
    invalidContact: "Invalid phone number or email format", // New
    otpPlaceholder: "Enter 6-digit code",
    sendCode: "Send Verification Code", // Updated
    verifyCode: "Verify & Enter Studio",
    continueWithGoogle: "Continue with Google",
    continueWithApple: "Continue with Apple",
    loggingIn: "Authenticating...",
    setupProfile: "Complete Your Director Profile",
    directorName: "Login Email",
    directorRole: "Production Role",
    roleDirector: "Director",
    roleProducer: "Producer",
    roleWriter: "Writer",
    roleArtist: "Concept Artist",
    enterStudio: "Enter Studio",

    // Studio Actions
    storyConcept: "Story Concept",
    storyPlaceholder: "e.g. A panda practicing kung fu in a bamboo forest...",
    generateButton: "Generate Storyboard",
    generating: "Directing Scenes...",
    settings: "Settings",
    sceneHeader: "Scene",
    imgPrompt: "Image Source",
    videoPrompt: "Video Output (Img2Video)",
    genImage: "Generate Image",
    genImageLoading: "Generating...",
    animate: "Animate",
    animateLoading: "Animating...",
    copy: "Copy",
    copied: "Copied!",
    anchorTitle: "Character Anchor",
    copyAnchor: "Copy Anchor",
    waitingImage: "Waiting for image input...",
    noImage: "No image generated yet",
    renderingVideo: "Rendering Video...",
    footerNote: "Note: Direct browser calls to Replicate may require disabling CORS in dev or using a proxy in production.",
    settingsModalTitle: "Settings",
    tokenLabel: "Replicate API Token",
    tokenHelp: "Stored locally in your browser. Required for image/video generation.",
    getTokenLink: "Get token",
    cancel: "Cancel",
    save: "Save Settings",
    apiError: "Failed to generate storyboard. Please check your API key and try again.",
    missingToken: "Please add your Replicate API Token in Settings.",
    
    // Mode Translations
    genModeLabel: "Generation Mode",
    storyboardMode: "Storyboard Mode (Independent)",
    storyMode: "Story Mode (Continuous)",
    storyModeBadge: "🔒 Story Continuity Mode: ON",
    videoQuality: "Video Quality",
    qualityDraft: "Draft (Fastest)",
    qualityStd: "Standard (Balanced)",
    qualityPro: "Pro (High Detail)",
    videoSpecs: "Output Specifications",
    duration: "Duration",
    fps: "Frame Rate",
    resolution: "Resolution",

    // Missing keys found in UI components
    writersRoom: "Writer's Room",
    backToConcept: "Back to Concept",
    godModeActivated: "God Mode Activated",
    cat_chinese: "Chinese Aesthetics",
    cat_cinema: "Cinema & Realism",
    cat_anime: "Art & Anime",
    proSettings: "Pro Settings",
    highValue: "High Value",
    imageEngine: "Image Engine",
    videoEngine: "Video Engine",
    frameFormat: "Frame Format",
    stylePreset: "Style Preset",
    adminUnlock: "Unlock",
    backToWriter: "Back to Writer's Room"
  },
  zh: {
    appTitle: "AI 漫剧导演",
    appSubtitle: "使用锚点一致性方法，将你的故事创意转化为生产级的分镜脚本。",
    
    // 登录流程
    oneClickLogin: "剪映账号一键登录",
    otherMethods: "其他账号登录",
    bindingAccount: "正在绑定账号...",
    agreeTerms: "已阅读并同意 用户协议 和 隐私政策",
    detectedAccount: "识别到可用账号，可授权登录",
    bindSocial: "绑定社交账号以进入工作室",

    // 登录界面
    welcomeBack: "欢迎回来，导演",
    startProduction: "请登入以开始制片",
    phonePlaceholder: "手机号码或电子邮箱", // Updated
    invalidContact: "手机号或邮箱格式不正确", // New
    otpPlaceholder: "输入6位验证码",
    sendCode: "发送验证码", // Updated
    verifyCode: "验证并进入工作室",
    continueWithGoogle: "使用 Google 登入",
    continueWithApple: "使用 Apple 登入",
    loggingIn: "正在身份验证...",
    setupProfile: "完善您的导演资料",
    directorName: "登录邮箱",
    directorRole: "制片职位",
    roleDirector: "导演",
    roleProducer: "制片人",
    roleWriter: "编剧",
    roleArtist: "概念美术",
    enterStudio: "进入工作室",

    // 工作室操作
    storyConcept: "故事灵感",
    storyPlaceholder: "例如：一只在竹林里练功夫的熊猫...",
    generateButton: "生成分镜脚本",
    generating: "正在导演中...",
    settings: "设置",
    sceneHeader: "第 X 幕",
    imgPrompt: "画面生成",
    videoPrompt: "视频生成 (图生视频)",
    genImage: "生成图片",
    genImageLoading: "生成中...",
    animate: "生成视频",
    animateLoading: "渲染中...",
    copy: "复制",
    copied: "已复制",
    anchorTitle: "角色锚点 (一致性设定)",
    copyAnchor: "复制锚点",
    waitingImage: "等待图片输入...",
    noImage: "暂无图片",
    renderingVideo: "视频渲染中...",
    footerNote: "注意：浏览器直接调用 Replicate 可能需要配置 CORS 或使用代理。",
    settingsModalTitle: "设置",
    tokenLabel: "Replicate API Token",
    tokenHelp: "仅存储在本地浏览器中。用于生成图片和视频。",
    getTokenLink: "获取 Token",
    cancel: "取消",
    save: "保存设置",
    apiError: "生成失败，请检查 API Key 后重试。",
    missingToken: "请在设置中添加 Replicate API Token。",

    // 模式
    genModeLabel: "生成模式",
    storyboardMode: "分镜模式 (独立场景)",
    storyMode: "故事模式 (连续剧情)",
    storyModeBadge: "🔒 故事连续性模式: 开启",
    videoQuality: "视频质量",
    qualityDraft: "草稿 (最快)",
    qualityStd: "标准 (平衡)",
    qualityPro: "专业 (高细节)",
    videoSpecs: "输出规格",
    duration: "时长",
    fps: "帧率",
    resolution: "分辨率",

    // Missing keys found in UI components
    writersRoom: "编剧工作室",
    backToConcept: "返回创意",
    godModeActivated: "上帝模式已激活",
    cat_chinese: "中式美学",
    cat_cinema: "电影与写实",
    cat_anime: "艺术与动漫",
    proSettings: "专业设置",
    highValue: "高价值",
    imageEngine: "图像引擎",
    videoEngine: "视频引擎",
    frameFormat: "画幅格式",
    stylePreset: "风格预设",
    adminUnlock: "解锁",
    backToWriter: "返回编剧室"
  }
};

export const t = (lang: Language, key: keyof typeof translations['en']) => {
  return translations[lang][key] || translations['en'][key] || key;
};
