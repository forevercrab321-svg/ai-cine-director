/**
 * DirectorControlsPanel — Full creative direction UI
 * Controls that feed directly into the AI generation pipeline.
 * All fields map 1:1 to DirectorControls type.
 */
import React, { useState } from 'react';
import {
  DirectorControls,
  DEFAULT_DIRECTOR_CONTROLS,
  ToneMode,
  PacingStyle,
  NarrativeDistance,
  OpeningHookStyle,
  EndingStyle,
  VisualPhilosophy,
  CameraMotivation,
  LightingMotivation,
  SoundMotivation,
  RealismMode,
} from '../types';

interface Props {
  controls: DirectorControls;
  onChange: (c: DirectorControls) => void;
  collapsed?: boolean;
  lang?: 'en' | 'zh';
}

// ── Helpers ──────────────────────────────────────────────────────
const set = <K extends keyof DirectorControls>(
  c: DirectorControls,
  key: K,
  val: DirectorControls[K]
): DirectorControls => ({ ...c, [key]: val });

function SliderRow({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-xs font-mono text-indigo-400">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 rounded accent-indigo-500 cursor-pointer"
      />
      {hint && <p className="text-xs text-slate-600 mt-1">{hint}</p>}
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-indigo-500 outline-none"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function TextArea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 outline-none resize-none"
      />
    </div>
  );
}

// ── Genre weights editor ──────────────────────────────────────────
const GENRE_LIST = [
  'drama', 'thriller', 'action', 'romance', 'comedy',
  'horror', 'mystery', 'sci-fi', 'fantasy', 'documentary',
  'noir', 'western', 'historical',
];

function GenreWeights({
  weights,
  onChange,
}: {
  weights: Record<string, number>;
  onChange: (w: Record<string, number>) => void;
}) {
  const active = Object.keys(weights);
  const [adding, setAdding] = useState('');

  const toggle = (g: string) => {
    if (weights[g] !== undefined) {
      const next = { ...weights };
      delete next[g];
      onChange(next);
    } else {
      onChange({ ...weights, [g]: 60 });
    }
  };

  return (
    <div>
      <label className="block text-xs text-slate-500 mb-2">Genre Weights</label>
      <div className="flex flex-wrap gap-1 mb-3">
        {GENRE_LIST.map(g => (
          <button
            key={g}
            type="button"
            onClick={() => toggle(g)}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
              weights[g] !== undefined
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {g}
          </button>
        ))}
      </div>
      {active.map(g => (
        <div key={g} className="flex items-center gap-3 mb-2">
          <span className="text-xs text-indigo-300 w-20 capitalize">{g}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={weights[g]}
            onChange={e => onChange({ ...weights, [g]: Number(e.target.value) })}
            className="flex-1 h-1 accent-indigo-500 cursor-pointer"
          />
          <span className="text-xs font-mono text-slate-400 w-8 text-right">{weights[g]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-slate-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-900 hover:bg-slate-800 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span>{icon}</span>
          <span>{title}</span>
        </span>
        <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 py-4 bg-slate-950 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
const DirectorControlsPanel: React.FC<Props> = ({
  controls,
  onChange,
  collapsed = false,
}) => {
  const [panelOpen, setPanelOpen] = useState(!collapsed);
  const c = controls;
  const up = <K extends keyof DirectorControls>(key: K, val: DirectorControls[K]) =>
    onChange(set(c, key, val));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setPanelOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">🎬</span>
          <div className="text-left">
            <p className="font-bold text-white text-sm">Director Controls</p>
            <p className="text-xs text-slate-500">
              {panelOpen ? 'Configure your creative vision' : `Tone: ${c.tone} · Pacing: ${c.pacing} · ${c.visualPhilosophy}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onChange(DEFAULT_DIRECTOR_CONTROLS); }}
            className="text-xs text-slate-600 hover:text-slate-400 px-2 py-1 border border-slate-700 rounded"
          >
            Reset
          </button>
          <span className="text-slate-500 text-sm">{panelOpen ? '▲' : '▼'}</span>
        </div>
      </button>

      {panelOpen && (
        <div className="px-5 pb-5 space-y-4">

          {/* NARRATIVE ARCHITECTURE */}
          <Section title="Narrative Architecture" icon="📖">
            <div className="grid grid-cols-2 gap-3">
              <Select<ToneMode>
                label="Tone"
                value={c.tone}
                onChange={v => up('tone', v)}
                options={[
                  { value: 'dark', label: '🌑 Dark' },
                  { value: 'neutral', label: '⚖️ Neutral' },
                  { value: 'hopeful', label: '☀️ Hopeful' },
                  { value: 'comedic', label: '😄 Comedic' },
                  { value: 'tragic', label: '💔 Tragic' },
                  { value: 'satirical', label: '🃏 Satirical' },
                ]}
              />
              <Select<PacingStyle>
                label="Pacing"
                value={c.pacing}
                onChange={v => up('pacing', v)}
                options={[
                  { value: 'slow_burn', label: '🕯️ Slow Burn' },
                  { value: 'steady', label: '🚶 Steady' },
                  { value: 'propulsive', label: '🏃 Propulsive' },
                  { value: 'frenetic', label: '⚡ Frenetic' },
                ]}
              />
              <Select<NarrativeDistance>
                label="Narrative Distance"
                value={c.narrativeDistance}
                onChange={v => up('narrativeDistance', v)}
                options={[
                  { value: 'intimate', label: '🔍 Intimate' },
                  { value: 'observational', label: '👁️ Observational' },
                  { value: 'epic', label: '🌍 Epic' },
                  { value: 'detached', label: '🧊 Detached' },
                ]}
              />
              <Select<OpeningHookStyle>
                label="Opening Hook"
                value={c.openingHook}
                onChange={v => up('openingHook', v)}
                options={[
                  { value: 'in_medias_res', label: '💥 In Medias Res' },
                  { value: 'establishing', label: '🏙️ Establishing' },
                  { value: 'mystery', label: '❓ Mystery' },
                  { value: 'action', label: '🔥 Action Open' },
                  { value: 'character_intro', label: '👤 Character Intro' },
                ]}
              />
              <Select<EndingStyle>
                label="Ending Style"
                value={c.endingStyle}
                onChange={v => up('endingStyle', v)}
                options={[
                  { value: 'resolved', label: '✅ Resolved' },
                  { value: 'open_ended', label: '🔄 Open Ended' },
                  { value: 'cliffhanger', label: '🪝 Cliffhanger' },
                  { value: 'bittersweet', label: '🌹 Bittersweet' },
                  { value: 'twist', label: '🌀 Twist' },
                ]}
              />
              <div className="flex flex-col gap-2">
                <label className="text-xs text-slate-500">Subplot Threads: {c.subplotThreads}</label>
                <input
                  type="range" min={0} max={3} step={1}
                  value={c.subplotThreads}
                  onChange={e => up('subplotThreads', Number(e.target.value))}
                  className="w-full h-1 accent-indigo-500 cursor-pointer"
                />
              </div>
            </div>
            <SliderRow
              label="Emotional Escalation"
              value={c.emotionalEscalation}
              onChange={v => up('emotionalEscalation', v)}
              hint="How aggressively does emotional intensity build across scenes?"
            />
            <div className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                id="reversal"
                checked={c.reversalAtMidpoint}
                onChange={e => up('reversalAtMidpoint', e.target.checked)}
                className="w-4 h-4 accent-indigo-500"
              />
              <label htmlFor="reversal" className="text-sm text-slate-300 cursor-pointer">
                Insert midpoint reversal / turn
              </label>
            </div>
          </Section>

          {/* VISUAL SYSTEM */}
          <Section title="Visual System" icon="🎥">
            <div className="grid grid-cols-2 gap-3">
              <Select<VisualPhilosophy>
                label="Visual Philosophy"
                value={c.visualPhilosophy}
                onChange={v => up('visualPhilosophy', v)}
                options={[
                  { value: 'naturalistic', label: '🌿 Naturalistic' },
                  { value: 'expressionistic', label: '🎨 Expressionistic' },
                  { value: 'minimalist', label: '⬜ Minimalist' },
                  { value: 'maximalist', label: '🌈 Maximalist' },
                  { value: 'documentary', label: '📹 Documentary' },
                ]}
              />
              <Select<RealismMode>
                label="Realism Level"
                value={c.realism}
                onChange={v => up('realism', v)}
                options={[
                  { value: 'stylized', label: '✨ Stylized' },
                  { value: 'cinematic', label: '🎬 Cinematic' },
                  { value: 'photoreal', label: '📸 Photoreal' },
                ]}
              />
              <Select<CameraMotivation>
                label="Camera Motivation"
                value={c.cameraMotivation}
                onChange={v => up('cameraMotivation', v)}
                options={[
                  { value: 'character_follows', label: '👤 Follows Character' },
                  { value: 'environment_reveals', label: '🌍 Reveals Environment' },
                  { value: 'tension_builds', label: '⚡ Builds Tension' },
                  { value: 'god_view', label: '👁️ God View' },
                ]}
              />
              <Select<LightingMotivation>
                label="Lighting Motivation"
                value={c.lightingMotivation}
                onChange={v => up('lightingMotivation', v)}
                options={[
                  { value: 'natural', label: '☀️ Natural' },
                  { value: 'dramatic_key', label: '🎭 Dramatic Key' },
                  { value: 'flat_even', label: '⬛ Flat/Even' },
                  { value: 'practical_only', label: '💡 Practical Only' },
                  { value: 'neon_practical', label: '🔮 Neon/Practical' },
                ]}
              />
              <Select<SoundMotivation>
                label="Sound Design"
                value={c.soundMotivation}
                onChange={v => up('soundMotivation', v)}
                options={[
                  { value: 'diegetic_focus', label: '🎙️ Diegetic Focus' },
                  { value: 'score_driven', label: '🎵 Score Driven' },
                  { value: 'silence_as_tool', label: '🤫 Silence as Tool' },
                  { value: 'ambient_texture', label: '🌊 Ambient Texture' },
                ]}
              />
              <div>
                <label className="block text-xs text-slate-500 mb-1">Preferred Lens</label>
                <input
                  type="text"
                  value={c.preferredLens}
                  onChange={e => up('preferredLens', e.target.value)}
                  placeholder="e.g. 35mm anamorphic"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 outline-none"
                />
              </div>
            </div>
            <SliderRow
              label="Shot Density (shots/scene)"
              value={c.shotDensity}
              min={1}
              max={10}
              onChange={v => up('shotDensity', v)}
              hint="1 = wide sparse compositions, 10 = rapid cutting rhythm"
            />
          </Section>

          {/* GENRE SYSTEM */}
          <Section title="Genre System" icon="🎭">
            <GenreWeights
              weights={c.genreWeights}
              onChange={w => up('genreWeights', w)}
            />
          </Section>

          {/* DIALOGUE SYSTEM */}
          <Section title="Dialogue System" icon="💬">
            <SliderRow
              label="Subtext Level"
              value={c.subtextLevel}
              onChange={v => up('subtextLevel', v)}
              hint="0 = explicit on-the-nose dialogue, 100 = all subtext"
            />
            <SliderRow
              label="Dialogue Density"
              value={c.dialogueDensity}
              onChange={v => up('dialogueDensity', v)}
              hint="0 = pure visual storytelling, 100 = dialogue-heavy"
            />
            <TextArea
              label="Blocking / Proxemics Style"
              value={c.preferredBlockingStyle}
              placeholder="e.g. Characters are always in motion; physical distance reflects emotional state"
              onChange={v => up('preferredBlockingStyle', v)}
            />
          </Section>

          {/* CONTINUITY & RULES */}
          <Section title="Continuity & Rules" icon="📋">
            <TextArea
              label="Continuity Rules"
              value={c.continuityRules}
              placeholder="e.g. Protagonist always enters from camera left. Coffee cup always full in morning scenes."
              onChange={v => up('continuityRules', v)}
            />
            <TextArea
              label="Motif System"
              value={c.motifSystem}
              placeholder="e.g. Red roses = danger. Rain = loss. Mirror shots = identity crisis."
              onChange={v => up('motifSystem', v)}
            />
            <TextArea
              label="Banned Elements"
              value={c.bannedElements}
              placeholder="e.g. No CGI fire. No jump cuts. No narration voiceover."
              onChange={v => up('bannedElements', v)}
            />
            <TextArea
              label="Avoid Phrases / Words"
              value={c.avoidPhrases}
              placeholder="e.g. never use 'stunning', 'vibrant', 'dramatic lighting'"
              onChange={v => up('avoidPhrases', v)}
            />
          </Section>

          {/* GENERATION META */}
          <Section title="AI Generation Settings" icon="⚙️">
            <SliderRow
              label="Creativity Temperature"
              value={Math.round(c.generationTemperature * 100)}
              onChange={v => up('generationTemperature', v / 100)}
              hint="Lower = more predictable, Higher = more surprising"
            />
          </Section>

        </div>
      )}
    </div>
  );
};

export default DirectorControlsPanel;
