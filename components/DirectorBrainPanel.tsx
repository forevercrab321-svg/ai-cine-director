import React, { useState } from 'react';
import { StoryboardProject, Language } from '../types';
import { t } from '../i18n';

interface Props {
    project: StoryboardProject;
    lang: Language;
}

const SectionBlock: React.FC<{ title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean }> = ({
    title, icon, children, defaultOpen = false
}) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border border-slate-700/60 rounded-xl overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/80 hover:bg-slate-800/80 transition-colors"
            >
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-300">
                    <span>{icon}</span>
                    <span>{title}</span>
                </span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <div className="px-4 pb-4 pt-3 bg-slate-950/40 animate-in fade-in duration-200">
                    {children}
                </div>
            )}
        </div>
    );
};

const DirectorBrainPanel: React.FC<Props> = ({ project, lang }) => {
    const brain = project as any; // All fields are on the project root
    const dirOS = project.director_brain as any;

    if (!brain.logline && !brain.world_setting && !brain.character_bible?.length) {
        return null;
    }

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center gap-3 mb-1">
                <div className="w-1 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-violet-600" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">
                    🧠 {t(lang, 'directorBrain')}
                </h3>
            </div>

            {/* Logline */}
            {brain.logline && (
                <div className="bg-gradient-to-r from-indigo-900/30 to-violet-900/20 border border-indigo-500/20 rounded-xl px-4 py-3">
                    <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-bold mb-1">
                        🎬 {t(lang, 'logline')}
                    </div>
                    <p className="text-slate-200 text-sm leading-relaxed italic">"{brain.logline}"</p>
                </div>
            )}

            {/* World Setting */}
            {brain.world_setting && (
                <SectionBlock title={t(lang, 'worldSetting')} icon="🌍" defaultOpen={true}>
                    <p className="text-slate-400 text-xs leading-relaxed">{brain.world_setting}</p>
                </SectionBlock>
            )}

            {/* Style Bible */}
            {brain.style_bible && (
                <SectionBlock title={t(lang, 'styleBible')} icon="🎨" defaultOpen={false}>
                    <div className="grid grid-cols-1 gap-2 text-xs">
                        {brain.style_bible.color_palette && (
                            <div>
                                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Color Palette</span>
                                <p className="text-slate-300 mt-0.5">{brain.style_bible.color_palette}</p>
                            </div>
                        )}
                        {brain.style_bible.lens_language && (
                            <div>
                                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Lens Language</span>
                                <p className="text-slate-300 mt-0.5">{brain.style_bible.lens_language}</p>
                            </div>
                        )}
                        {brain.style_bible.lighting && (
                            <div>
                                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Lighting</span>
                                <p className="text-slate-300 mt-0.5">{brain.style_bible.lighting}</p>
                            </div>
                        )}
                    </div>
                </SectionBlock>
            )}

            {/* Character Bible */}
            {Array.isArray(brain.character_bible) && brain.character_bible.length > 0 && (
                <SectionBlock title={t(lang, 'characterBible')} icon="👤" defaultOpen={false}>
                    <div className="space-y-3">
                        {brain.character_bible.map((char: any, idx: number) => (
                            <div key={char.character_id || idx} className="border border-slate-700/40 rounded-lg p-3 space-y-1">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold text-white">
                                        {(char.name || '?')[0].toUpperCase()}
                                    </div>
                                    <span className="text-slate-200 text-xs font-bold">{char.name}</span>
                                    {char.age && <span className="text-slate-500 text-[10px]">{char.age}</span>}
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1 text-[10px]">
                                    {char.face_traits && (
                                        <div><span className="text-slate-600 uppercase font-bold">Face</span><p className="text-slate-400">{char.face_traits}</p></div>
                                    )}
                                    {char.hair && (
                                        <div><span className="text-slate-600 uppercase font-bold">Hair</span><p className="text-slate-400">{char.hair}</p></div>
                                    )}
                                    {char.outfit && (
                                        <div><span className="text-slate-600 uppercase font-bold">Outfit</span><p className="text-slate-400 col-span-2">{char.outfit}</p></div>
                                    )}
                                    {char.props && char.props !== 'none' && (
                                        <div><span className="text-slate-600 uppercase font-bold">Props</span><p className="text-slate-400">{char.props}</p></div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </SectionBlock>
            )}

            {/* ── Director OS Layers ── */}
            {dirOS && (
                <>
                    {/* Story Arc */}
                    {dirOS.story_arc && (
                        <SectionBlock title="Story Arc" icon="📖" defaultOpen={false}>
                            <p className="text-slate-400 text-xs leading-relaxed">{dirOS.story_arc}</p>
                        </SectionBlock>
                    )}

                    {/* Emotional Beats */}
                    {Array.isArray(dirOS.emotional_beats) && dirOS.emotional_beats.length > 0 && (
                        <SectionBlock title="Emotional Beats" icon="💓" defaultOpen={false}>
                            <ol className="space-y-1">
                                {dirOS.emotional_beats.map((beat: string, i: number) => (
                                    <li key={i} className="flex gap-2 text-xs">
                                        <span className="text-indigo-500 font-bold shrink-0">{i + 1}.</span>
                                        <span className="text-slate-400">{beat}</span>
                                    </li>
                                ))}
                            </ol>
                        </SectionBlock>
                    )}

                    {/* Visual Beats */}
                    {Array.isArray(dirOS.visual_beats) && dirOS.visual_beats.length > 0 && (
                        <SectionBlock title="Visual Beats" icon="🎞️" defaultOpen={false}>
                            <ol className="space-y-1">
                                {dirOS.visual_beats.map((beat: string, i: number) => (
                                    <li key={i} className="flex gap-2 text-xs">
                                        <span className="text-violet-500 font-bold shrink-0">{i + 1}.</span>
                                        <span className="text-slate-400">{beat}</span>
                                    </li>
                                ))}
                            </ol>
                        </SectionBlock>
                    )}

                    {/* Pacing Strategy */}
                    {dirOS.pacing_strategy && (
                        <SectionBlock title="Pacing Strategy" icon="⏱️" defaultOpen={false}>
                            <p className="text-slate-400 text-xs leading-relaxed">{dirOS.pacing_strategy}</p>
                        </SectionBlock>
                    )}

                    {/* Directorial Rules */}
                    {Array.isArray(dirOS.directorial_rules) && dirOS.directorial_rules.length > 0 && (
                        <SectionBlock title="Directorial Laws" icon="⚖️" defaultOpen={false}>
                            <ul className="space-y-1">
                                {dirOS.directorial_rules.map((rule: string, i: number) => (
                                    <li key={i} className="flex gap-2 text-xs">
                                        <span className="text-amber-500 shrink-0">▸</span>
                                        <span className="text-slate-400">{rule}</span>
                                    </li>
                                ))}
                            </ul>
                        </SectionBlock>
                    )}

                    {/* Character Focus Rules */}
                    {dirOS.character_focus_rules && Object.keys(dirOS.character_focus_rules).length > 0 && (
                        <SectionBlock title="Character Focus Rules" icon="🎯" defaultOpen={false}>
                            <div className="space-y-2">
                                {Object.entries(dirOS.character_focus_rules).map(([name, rule]: [string, any]) => (
                                    <div key={name} className="text-xs">
                                        <span className="text-slate-300 font-bold">{name}: </span>
                                        <span className="text-slate-500">{String(rule)}</span>
                                    </div>
                                ))}
                            </div>
                        </SectionBlock>
                    )}
                </>
            )}
        </div>
    );
};

export default DirectorBrainPanel;
