/**
 * DirectorOSStatus — shows per-layer Director OS pass/fail status.
 * Renders a visible WARNING banner when any critical layer has failed.
 * This is NOT a tooltip or badge — it's a full-width alert strip.
 */
import React, { useState } from 'react';

interface LayerStatus {
  pass: boolean;
  error?: string;
}

interface Props {
  layers: Record<string, LayerStatus> | undefined | null;
  degraded: boolean;
  criticalFailures: string[];
}

const LAYER_META: Record<string, { label: string; critical: boolean; icon: string }> = {
  director_brain:     { label: 'Director Brain',      critical: false, icon: '🧠' },
  storyboard_12panel: { label: '12-Panel Storyboard',  critical: false, icon: '🎞' },
  character_identity: { label: 'Character Identity',   critical: true,  icon: '🔐' },
  shot_graph:         { label: 'Shot Graph',           critical: false, icon: '⛓' },
  temporal_guidance:  { label: 'Temporal Guidance',    critical: true,  icon: '⏩' },
  edit_plan:          { label: 'Edit Plan',            critical: false, icon: '✂️' },
  verifier:           { label: 'Verifier',             critical: true,  icon: '✅' },
};

const DirectorOSStatus: React.FC<Props> = ({ layers, degraded, criticalFailures }) => {
  const [expanded, setExpanded] = useState(false);

  if (!layers) return null;

  const hasCriticalFail = criticalFailures.length > 0;

  return (
    <div className="rounded-xl overflow-hidden border border-slate-700/60">
      {/* ── Header bar ── */}
      <button
        onClick={() => setExpanded(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 transition-colors ${
          hasCriticalFail
            ? 'bg-rose-950/60 border-b border-rose-700/40'
            : degraded
            ? 'bg-amber-950/40 border-b border-amber-700/30'
            : 'bg-emerald-950/30 border-b border-emerald-700/20'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{hasCriticalFail ? '🔴' : degraded ? '🟡' : '🟢'}</span>
          <span className={`text-xs font-bold uppercase tracking-widest ${
            hasCriticalFail ? 'text-rose-300' : degraded ? 'text-amber-300' : 'text-emerald-300'
          }`}>
            Director OS
          </span>
          {hasCriticalFail ? (
            <span className="text-[10px] text-rose-400 font-bold ml-2">
              ⚠ CRITICAL FAILURE — {criticalFailures.join(', ')}
            </span>
          ) : degraded ? (
            <span className="text-[10px] text-amber-400 ml-2">DEGRADED MODE</span>
          ) : (
            <span className="text-[10px] text-emerald-400 ml-2">ALL LAYERS ACTIVE</span>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Critical failure callout (always visible if present) ── */}
      {hasCriticalFail && (
        <div className="px-4 py-2 bg-rose-900/20 border-b border-rose-700/30">
          <p className="text-[11px] text-rose-300 font-medium">
            ⛔ The following critical layers failed. Generation results may be unsafe or identity-broken:
          </p>
          <ul className="mt-1 space-y-0.5">
            {criticalFailures.map(k => (
              <li key={k} className="text-[10px] text-rose-400 flex gap-2">
                <span>{LAYER_META[k]?.icon ?? '?'}</span>
                <span><strong>{LAYER_META[k]?.label ?? k}</strong>: {layers[k]?.error ?? 'unknown error'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Layer grid (expandable) ── */}
      {expanded && (
        <div className="px-4 py-3 bg-slate-950/60 grid grid-cols-2 gap-2">
          {Object.entries(LAYER_META).map(([key, meta]) => {
            const status = layers[key];
            if (!status) return null;
            return (
              <div
                key={key}
                className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-[10px] ${
                  status.pass
                    ? 'bg-emerald-900/10 border-emerald-500/15'
                    : meta.critical
                    ? 'bg-rose-900/15 border-rose-500/30'
                    : 'bg-amber-900/10 border-amber-500/20'
                }`}
              >
                <span className="shrink-0 mt-0.5">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold ${status.pass ? 'text-slate-300' : meta.critical ? 'text-rose-300' : 'text-amber-300'}`}>
                      {meta.label}
                    </span>
                    {meta.critical && (
                      <span className="text-[8px] uppercase tracking-wider text-slate-600 font-bold">CRITICAL</span>
                    )}
                  </div>
                  {!status.pass && status.error && (
                    <p className="text-slate-500 mt-0.5 truncate" title={status.error}>{status.error}</p>
                  )}
                </div>
                <span className={`shrink-0 font-bold ${status.pass ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {status.pass ? '✓' : '✗'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DirectorOSStatus;
