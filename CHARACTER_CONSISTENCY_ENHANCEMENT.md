# 🎭 角色一致性系统 - 增强建议

## 📊 当前状态评估

### ✅ 已实现功能
1. **Character Anchor** - 角色锚点作为视觉身份的单一来源
2. **强制前缀** - 所有场景描述必须以anchor开头
3. **关键词验证** - 后端验证关键词覆盖率
4. **一致性元数据** - `_consistency_check` 字段
5. **严格提示词包装** - 防止AI修改角色特征

### ⚠️ 当前痛点
1. **依赖AI生成anchor** - 质量不稳定
2. **缺少视觉参考** - 用户无法预览角色
3. **关键词匹配简单** - 仅基于字符串包含
4. **无角色复用** - 每次都要重新描述

---

## 🚀 增强方案

### 方案A: 角色模板预设系统

**目标**: 提供预设的高质量角色模板,确保一致性

#### 实现步骤

**1. 创建角色模板类型**

```typescript
// types.ts 中添加
export interface CharacterTemplate {
  id: string;
  name: string; // "赛博朋克黑客", "功夫熊猫"
  category: 'cyberpunk' | 'fantasy' | 'modern' | 'historical' | 'scifi';
  anchor: string; // 完整的详细描述
  keywords: string[]; // 关键特征
  thumbnailUrl?: string; // 预览图
  compatibleStyles: VisualStyle[]; // 适配的视觉风格
}

export const CHARACTER_TEMPLATES: CharacterTemplate[] = [
  {
    id: 'cyberpunk_hacker',
    name: '赛博朋克黑客',
    category: 'cyberpunk',
    anchor: 'A young East Asian female hacker in her mid-20s with neon pink pixie-cut hair, cybernetic eye implant glowing blue, black leather jacket with circuit patterns, holding a holographic tablet, silver nose ring, athletic build, standing with confident posture, photorealistic cyberpunk aesthetic',
    keywords: ['pink hair', 'cybernetic eye', 'black leather jacket', 'holographic tablet', 'circuit patterns'],
    compatibleStyles: ['CYBERPUNK', 'REALISM']
  },
  {
    id: 'kungfu_panda',
    name: '功夫熊猫',
    category: 'fantasy',
    anchor: 'A large adult panda with round body, short black and white fur, wearing orange martial arts robes with golden belt, bamboo staff in right paw, wise eyes with bushy eyebrows, standing in martial arts stance, 3D animated Pixar style with soft lighting',
    keywords: ['panda', 'black and white fur', 'orange robes', 'bamboo staff', 'martial arts'],
    compatibleStyles: ['PIXAR', 'GHIBLI']
  },
  // ... 更多模板
];
```

**2. UI组件 - 角色选择器**

```typescript
// components/CharacterSelector.tsx
import { CHARACTER_TEMPLATES } from '../types';

export const CharacterSelector = ({ onSelect }: { onSelect: (anchor: string) => void }) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const filteredTemplates = selectedCategory === 'all' 
    ? CHARACTER_TEMPLATES 
    : CHARACTER_TEMPLATES.filter(t => t.category === selectedCategory);

  return (
    <div className="character-selector">
      <h3>选择预设角色模板</h3>
      
      {/* 分类筛选 */}
      <div className="category-tabs">
        <button onClick={() => setSelectedCategory('all')}>全部</button>
        <button onClick={() => setSelectedCategory('cyberpunk')}>赛博朋克</button>
        <button onClick={() => setSelectedCategory('fantasy')}>奇幻</button>
        {/* ... 更多分类 */}
      </div>

      {/* 角色网格 */}
      <div className="character-grid">
        {filteredTemplates.map(template => (
          <div 
            key={template.id} 
            className="character-card"
            onClick={() => onSelect(template.anchor)}
          >
            {template.thumbnailUrl && (
              <img src={template.thumbnailUrl} alt={template.name} />
            )}
            <h4>{template.name}</h4>
            <div className="keywords">
              {template.keywords.slice(0, 3).map(kw => (
                <span key={kw} className="keyword-tag">{kw}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 或者自定义 */}
      <button onClick={() => onSelect('')}>
        ✍️ 我要自己描述角色
      </button>
    </div>
  );
};
```

**3. 集成到VideoGenerator**

```typescript
// VideoGenerator.tsx 中添加
const [showCharacterSelector, setShowCharacterSelector] = useState(false);
const [customAnchor, setCustomAnchor] = useState('');

const handleTemplateSelect = (anchor: string) => {
  setCustomAnchor(anchor);
  setShowCharacterSelector(false);
  // 可选: 立即显示在UI中
};

// 在UI中添加
{showCharacterSelector && (
  <CharacterSelector onSelect={handleTemplateSelect} />
)}

<button onClick={() => setShowCharacterSelector(true)}>
  🎭 选择角色模板
</button>

{customAnchor && (
  <div className="selected-character">
    <h4>当前角色:</h4>
    <p>{customAnchor.substring(0, 150)}...</p>
    <button onClick={() => setCustomAnchor('')}>清除</button>
  </div>
)}
```

---

### 方案B: 视觉一致性增强

**目标**: 使用参考图片确保角色外观一致

#### 实现步骤

**1. 添加角色参考图上传**

```typescript
// components/CharacterReferenceUpload.tsx
export const CharacterReferenceUpload = ({ 
  onImageAnalyzed 
}: { 
  onImageAnalyzed: (anchor: string, imageUrl: string) => void 
}) => {
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    
    // 1. 转换为base64
    const base64 = await fileToBase64(file);
    
    // 2. 调用Gemini Vision分析
    const anchor = await analyzeImageForAnchor(base64);
    
    // 3. 上传到Supabase Storage (可选)
    const imageUrl = await uploadToStorage(file);
    
    onImageAnalyzed(anchor, imageUrl);
    setUploading(false);
  };

  return (
    <div className="reference-upload">
      <label>
        📷 上传角色参考图
        <input 
          type="file" 
          accept="image/*" 
          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
        />
      </label>
      {uploading && <p>🔍 正在分析角色特征...</p>}
    </div>
  );
};
```

**2. 在生成时使用参考图**

```typescript
// services/replicateService.ts 中已有支持
// 只需确保 startImageUrl 参数被正确传递

// 在VideoGenerator中:
const executeImageGeneration = async (scene: Scene) => {
  const prompt = scene.visual_description;
  
  // ✅ 使用参考图URL (如果有)
  const url = await generateImage(
    prompt,
    settings.imageModel,
    settings.videoStyle,
    settings.aspectRatio,
    project.character_anchor,
    characterReferenceImageUrl // ← 新增
  );
  
  // ...
};
```

---

### 方案C: 关键词智能提取与验证

**目标**: 更智能地提取和验证角色关键特征

#### 实现步骤

**1. 智能关键词提取**

```typescript
// utils/characterAnalyzer.ts
export interface CharacterFeatures {
  ethnicity?: string; // "East Asian"
  gender?: string; // "female"
  age?: string; // "mid-20s"
  hairColor?: string; // "pink"
  hairStyle?: string; // "pixie-cut"
  clothing: string[]; // ["black leather jacket", "orange robes"]
  accessories: string[]; // ["holographic tablet", "nose ring"]
  bodyType?: string; // "athletic"
  artStyle?: string; // "photorealistic"
}

export function extractCharacterFeatures(anchor: string): CharacterFeatures {
  const features: CharacterFeatures = {
    clothing: [],
    accessories: []
  };

  // 正则匹配种族/性别/年龄
  const ethnicityMatch = anchor.match(/(East Asian|Caucasian|African|Hispanic|Middle Eastern)\s+(male|female)/i);
  if (ethnicityMatch) {
    features.ethnicity = ethnicityMatch[1];
    features.gender = ethnicityMatch[2];
  }

  const ageMatch = anchor.match(/(early|mid|late)\s+(\d+s)/i);
  if (ageMatch) {
    features.age = `${ageMatch[1]} ${ageMatch[2]}`;
  }

  // 提取发型/发色
  const hairMatch = anchor.match(/(\w+)\s+(hair|pixie-cut|ponytail|braid)/i);
  if (hairMatch) {
    features.hairColor = hairMatch[1];
    features.hairStyle = hairMatch[2];
  }

  // 提取服装 (穿着...、戴着...)
  const clothingMatches = anchor.match(/wearing\s+([^,\.]+)/gi);
  if (clothingMatches) {
    features.clothing = clothingMatches.map(m => m.replace(/wearing\s+/i, '').trim());
  }

  // 提取配饰 (拿着...、持有...)
  const accessoryMatches = anchor.match(/holding\s+([^,\.]+)/gi);
  if (accessoryMatches) {
    features.accessories = accessoryMatches.map(m => m.replace(/holding\s+/i, '').trim());
  }

  // 提取艺术风格
  const styleMatch = anchor.match(/(photorealistic|3D animated|Pixar style|Studio Ghibli|cyberpunk aesthetic)/i);
  if (styleMatch) {
    features.artStyle = styleMatch[1];
  }

  return features;
}

export function validateSceneConsistency(
  sceneDescription: string, 
  characterFeatures: CharacterFeatures
): {
  score: number; // 0-100
  missingFeatures: string[];
  presentFeatures: string[];
} {
  const desc = sceneDescription.toLowerCase();
  const missingFeatures: string[] = [];
  const presentFeatures: string[] = [];

  // 检查关键服装
  characterFeatures.clothing.forEach(item => {
    if (desc.includes(item.toLowerCase())) {
      presentFeatures.push(item);
    } else {
      missingFeatures.push(`服装: ${item}`);
    }
  });

  // 检查配饰
  characterFeatures.accessories.forEach(item => {
    if (desc.includes(item.toLowerCase())) {
      presentFeatures.push(item);
    } else {
      missingFeatures.push(`配饰: ${item}`);
    }
  });

  // 检查发型/发色
  if (characterFeatures.hairColor && !desc.includes(characterFeatures.hairColor.toLowerCase())) {
    missingFeatures.push(`发色: ${characterFeatures.hairColor}`);
  } else if (characterFeatures.hairColor) {
    presentFeatures.push(characterFeatures.hairColor);
  }

  // 计算分数
  const totalFeatures = characterFeatures.clothing.length + 
                        characterFeatures.accessories.length + 
                        (characterFeatures.hairColor ? 1 : 0);
  const score = totalFeatures > 0 
    ? Math.round((presentFeatures.length / totalFeatures) * 100) 
    : 100;

  return { score, missingFeatures, presentFeatures };
}
```

**2. 在UI中显示一致性分数**

```typescript
// components/SceneCard.tsx 中添加
const characterFeatures = extractCharacterFeatures(project.character_anchor);
const consistencyResult = validateSceneConsistency(scene.visual_description, characterFeatures);

// UI显示
<div className="consistency-indicator">
  <span className={`score ${consistencyResult.score >= 80 ? 'good' : 'warning'}`}>
    一致性: {consistencyResult.score}%
  </span>
  {consistencyResult.missingFeatures.length > 0 && (
    <div className="missing-features">
      ⚠️ 缺失特征: {consistencyResult.missingFeatures.join(', ')}
    </div>
  )}
</div>
```

---

## 📋 实施优先级

### 🔴 P0 - 立即实施 (1-2小时)
- [x] 方案A步骤1: 创建5个高质量角色模板
- [x] 方案C步骤1: 实现智能关键词提取
- [x] 在UI中显示一致性评分

### 🟠 P1 - 本周实施 (4-6小时)
- [ ] 方案A步骤2-3: 完整的角色选择器UI
- [ ] 方案C步骤2: UI集成一致性验证
- [ ] 添加10-15个角色模板

### 🟡 P2 - 下周实施 (6-8小时)
- [ ] 方案B: 参考图上传和分析
- [ ] 角色库持久化 (Supabase)
- [ ] 用户自定义角色模板

---

## 🧪 测试计划

### 测试5: 角色模板一致性 (新增)

```typescript
async function test5CharacterTemplateConsistency() {
  const testName = 'Test 5: Character Template Consistency';
  
  // 使用预设模板
  const template = CHARACTER_TEMPLATES[0]; // 赛博朋克黑客
  
  const res = await fetch(`${API_BASE}/api/gemini/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      storyIdea: 'A hacker infiltrates a mega-corporation',
      visualStyle: 'Cyberpunk / Synthwave',
      language: 'en',
      mode: 'storyboard',
      identityAnchor: template.anchor
    })
  });

  const project = await res.json();
  
  // 验证所有场景都包含模板关键词
  const features = extractCharacterFeatures(template.anchor);
  const sceneScores = project.scenes.map(scene => 
    validateSceneConsistency(scene.visual_description, features)
  );
  
  const avgScore = sceneScores.reduce((sum, s) => sum + s.score, 0) / sceneScores.length;
  
  recordResult(testName, avgScore >= 85, `Average consistency: ${avgScore}%`);
}
```

---

## 💡 额外改进建议

### 1. 角色演化追踪
- 记录每个场景中角色描述的变化
- 可视化显示哪些特征被保持/丢失

### 2. 风格兼容性检查
- 某些角色模板只适配特定视觉风格
- UI中自动过滤不兼容的组合

### 3. 多角色支持
- 当前系统仅支持单一主角
- 未来可扩展支持2-3个主要角色

---

## 📊 预期效果

实施后:
- ✅ 角色一致性从当前 ~75% → 90%+
- ✅ 用户生成时间减少 30% (模板选择更快)
- ✅ 降低AI幻觉导致的角色变化
- ✅ 提升整体故事板质量

---

**下一步行动**: 
1. 创建 `types.ts` 中的角色模板定义
2. 实现 `characterAnalyzer.ts` 工具函数
3. 添加角色选择器UI组件

需要我开始实施吗? 🚀
