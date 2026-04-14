import React, { useMemo } from 'react';
import { StoryboardProject, Language } from '../types';
import { t } from '../i18n';

interface Props {
    project: StoryboardProject | null;
    lang: Language;
}

interface CheckItem {
    id: string;
    label: string;
    labelZh: string;
    pass: boolean;
    evidence: string;
    critical: boolean;
}

function runChecks(project: StoryboardProject | null): CheckItem[] {
    if (!project) {
        return [
            { id: 'project', label: 'Project exists', labelZh: '项目已存在', pass: false, evidence: 'No project loaded', critical: true },
        ];
    }
    const brain = project as any;
    const scenes = project.scenes || [];
    const shotsWithImage = scenes.filter(s => s.image_prompt && s.image_prompt.length > 20);
    const shotsWithVideo = scenes.filter(s => s.video_url);
    const shotsWithImageUrl = scenes.filter(s => s.image_url);
    const shotsWithDialogue = scenes.filter(s => s.dialogue_text);
    const shotsWithEmoBeat = scenes.filter(s => s.emotional_beat);
    const shotsWithVideoPrompt = scenes.filter(s => s.video_prompt && s.video_prompt.length > 20);

    return [
        {
            id: 'director_brain',
            label: 'Director Brain generated',
            labelZh: '导演脑已生成',
            pass: !!(brain.logline && brain.world_setting && brain.style_bible),
            evidence: brain.logline
                ? `Logline: "${brain.logline.substring(0, 60)}..."`
                : 'Missing: logline / world_setting / style_bible',
            critical: true,
        },
        {
            id: 'character_bible',
            label: 'Character bible populated',
            labelZh: '角色圣经已填充',
            pass: Array.isArray(brain.character_bible) && brain.character_bible.length > 0,
            evidence: Array.isArray(brain.character_bible)
                ? `${brain.character_bible.length} character(s): ${brain.character_bible.map((c: any) => c.name).join(', ')}`
                : 'No character_bible array',
            critical: false,
        },
        {
            id: 'shot_list',
            label: 'Shot list generated',
            labelZh: '镜头表已生成',
            pass: scenes.length > 0,
            evidence: `${scenes.length} shots across ${new Set(scenes.map(s => (s as any).scene_id)).size} scenes`,
            critical: true,
        },
        {
            id: 'image_prompts',
            label: 'Image prompts for all shots',
            labelZh: '所有镜头有图片提示词',
            pass: scenes.length > 0 && shotsWithImage.length === scenes.length,
            evidence: `${shotsWithImage.length}/${scenes.length} shots have image_prompt`,
            critical: true,
        },
        {
            id: 'video_prompts',
            label: 'Video prompts for all shots',
            labelZh: '所有镜头有视频提示词',
            pass: scenes.length > 0 && shotsWithVideoPrompt.length === scenes.length,
            evidence: `${shotsWithVideoPrompt.length}/${scenes.length} shots have video_prompt`,
            critical: true,
        },
        {
            id: 'dialogue',
            label: 'Dialogue fields present',
            labelZh: '对话字段已填充',
            pass: shotsWithDialogue.length > 0,
            evidence: `${shotsWithDialogue.length} shots with dialogue text`,
            critical: false,
        },
        {
            id: 'emotional_beats',
            label: 'Emotional beats present',
            labelZh: '情感节拍已填充',
            pass: shotsWithEmoBeat.length > 0,
            evidence: `${shotsWithEmoBeat.length} shots with emotional_beat`,
            critical: false,
        },
        {
            id: 'images_generated',
            label: 'Images generated',
            labelZh: '图像已生成',
            pass: shotsWithImageUrl.length > 0,
            evidence: `${shotsWithImageUrl.length}/${scenes.length} shots have image_url`,
            critical: false,
        },
        {
            id: 'videos_generated',
            label: 'Videos generated',
            labelZh: '视频已生成',
            pass: shotsWithVideo.length > 0,
            evidence: `${shotsWithVideo.length}/${scenes.length} shots have video_url`,
            critical: false,
        },
        {
            id: 'style_bible',
            label: 'Style bible complete',
            labelZh: '风格圣经完整',
            pass: !!(brain.style_bible?.color_palette && brain.style_bible?.lens_language && brain.style_bible?.lighting),
            evidence: brain.style_bible
                ? `Palette: ${brain.style_bible.color_palette ? '✓' : '✗'} | Lens: ${brain.style_bible.lens_language ? '✓' : '✗'} | Lighting: ${brain.style_bible.lighting ? '✓' : '✗'}`
                : 'No style_bible',
            critical: false,
        },
    ];
}

const VerificationPanel: React.FC<Props> = ({ project, lang }) => {
    const checks = useMemo(() => runChecks(project), [project]);
    const total = checks.length;
    const passed = checks.filter(c => c.pass).length;
    const critical = checks.filter(c => c.critical);
    const criticalPassed = critical.filter(c => c.pass).length;
    const allCriticalPass = criticalPassed === critical.length;

    const scoreColor = passed / total >= 0.8
        ? 'text-emerald-400'
        : passed / total >= 0.5
        ? 'text-amber-400'
        : 'text-rose-400';

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-1 h-6 rounded-full bg-gradient-to-b from-emerald-500 to-teal-600" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">
                        ✅ {t(lang, 'verificationPanel')}
                    </h3>
                </div>
                <div className={`text-sm font-bold font-mono ${scoreColor}`}>
                    {passed}/{total}
                    <span className="text-slate-600 font-normal text-xs ml-2">
                        {allCriticalPass ? '🟢 READY' : '🔴 NOT READY'}
                    </span>
                </div>
            </div>

            {/* Score bar */}
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${passed / total >= 0.8 ? 'bg-emerald-500' : passed / total >= 0.5 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${(passed / total) * 100}%` }}
                />
            </div>

            {/* Check list */}
            <div className="space-y-1.5">
                {checks.map(check => (
                    <div
                        key={check.id}
                        className={`flex items-start gap-3 px-3 py-2 rounded-lg border ${check.pass
                            ? 'bg-emerald-900/10 border-emerald-500/20'
                            : check.critical
                            ? 'bg-rose-900/15 border-rose-500/30'
                            : 'bg-slate-900/30 border-slate-700/30'
                        }`}
                    >
                        <span className={`text-sm flex-shrink-0 mt-0.5 ${check.pass ? 'text-emerald-400' : check.critical ? 'text-rose-400' : 'text-slate-500'}`}>
                            {check.pass ? '✓' : check.critical ? '✗' : '○'}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium ${check.pass ? 'text-slate-200' : check.critical ? 'text-rose-300' : 'text-slate-400'}`}>
                                    {lang === 'zh' ? check.labelZh : check.label}
                                </span>
                                {check.critical && !check.pass && (
                                    <span className="text-[9px] uppercase tracking-wider text-rose-500 font-bold bg-rose-900/30 px-1.5 rounded">critical</span>
                                )}
                            </div>
                            <p className="text-[10px] text-slate-600 mt-0.5 truncate">{check.evidence}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default VerificationPanel;
