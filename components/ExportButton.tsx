/**
 * ExportButton — Dropdown to export the current project in multiple formats
 */
import React, { useState, useRef, useEffect } from 'react';
import { StoryboardProject } from '../types';
import { exportProjectJson, exportShotBible, exportScenesCsv } from '../utils/exportProject';

interface Props {
  project: StoryboardProject;
  lang?: 'en' | 'zh';
}

const ExportButton: React.FC<Props> = ({ project, lang = 'en' }) => {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const isZh = lang === 'zh';

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const run = async (key: string, fn: () => void) => {
    setExporting(key);
    setOpen(false);
    try { fn(); } catch (e) { console.error('Export failed:', e); }
    setTimeout(() => setExporting(null), 1500);
  };

  const options = [
    {
      key: 'json',
      icon: '📦',
      label: isZh ? '完整 JSON 导出' : 'Full JSON Export',
      desc: isZh ? '所有项目数据，可导入恢复' : 'All project data, importable',
      fn: () => exportProjectJson(project),
    },
    {
      key: 'shotbible',
      icon: '📋',
      label: isZh ? '分镜圣经 (Markdown)' : 'Shot Bible (Markdown)',
      desc: isZh ? '场景与镜头的完整文档' : 'Full scene & shot documentation',
      fn: () => exportShotBible(project),
    },
    {
      key: 'csv',
      icon: '📊',
      label: isZh ? '场景列表 (CSV)' : 'Scene List (CSV)',
      desc: isZh ? '适合导入电子表格' : 'Import into spreadsheets',
      fn: () => exportScenesCsv(project),
    },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={!!exporting}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
          open
            ? 'bg-slate-700 border-slate-500 text-white'
            : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
        } disabled:opacity-50`}
      >
        {exporting ? (
          <span className="animate-spin text-base">⏳</span>
        ) : (
          <span>↗</span>
        )}
        {isZh ? '导出' : 'Export'}
        <span className="text-xs opacity-50">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {options.map(opt => (
            <button
              key={opt.key}
              onClick={() => run(opt.key, opt.fn)}
              className="w-full text-left px-4 py-3 hover:bg-slate-800 transition-colors border-b border-slate-800 last:border-b-0 group"
            >
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{opt.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">
                    {opt.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{opt.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExportButton;
