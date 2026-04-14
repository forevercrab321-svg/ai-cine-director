/**
 * ProjectDashboard — Lists all user projects, allows create / resume / delete
 */
import React, { useEffect, useState, useCallback } from 'react';
import { fetchUserStoryboards, fetchStoryboardDetails, deleteStoryboard } from '../services/storyboardService';
import { StoryboardProject } from '../types';
import { LoaderIcon } from './IconComponents';

interface StoryboardRow {
  id: string;
  project_title?: string;
  title?: string;             // DB column alias — may come back as either
  logline?: string;
  created_at: string;
  updated_at?: string;
  scenes?: any[];
  thumbnail?: string | null;
}

interface Props {
  userId: string;
  lang: 'en' | 'zh';
  onResumeProject: (project: StoryboardProject) => void;
  onNewProject: () => void;
}

const ProjectDashboard: React.FC<Props> = ({ userId, lang, onResumeProject, onNewProject }) => {
  const [projects, setProjects] = useState<StoryboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const isZh = lang === 'zh';

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserStoryboards(userId);
      setProjects(data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleResume = async (id: string) => {
    setLoadingId(id);
    try {
      const project = await fetchStoryboardDetails(id);
      if (project) onResumeProject(project as StoryboardProject);
    } catch (e: any) {
      setError(e.message || 'Failed to load project');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm(
      isZh ? '确认删除此项目？此操作不可撤销。' : 'Delete this project? This cannot be undone.'
    );
    if (!confirmed) return;

    setDeletingId(id);
    try {
      const ok = await deleteStoryboard(id);
      if (!ok) throw new Error('Delete failed — check Supabase RLS policy');
      setProjects(prev => prev.filter(p => p.id !== id));
    } catch (e: any) {
      setError(e.message || 'Failed to delete project');
    } finally {
      setDeletingId(null);
    }
  };

  const getTitle = (p: StoryboardRow) => p.project_title || p.title || '';

  const filtered = projects.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return getTitle(p).toLowerCase().includes(q) ||
           (p.logline || '').toLowerCase().includes(q);
  });

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch { return iso; }
  };

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header Row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">
            {isZh ? '🎬 我的项目' : '🎬 My Projects'}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {isZh ? `共 ${projects.length} 个项目` : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={onNewProject}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/25 transition-all"
        >
          <span className="text-lg leading-none">+</span>
          {isZh ? '新建项目' : 'New Project'}
        </button>
      </div>

      {/* Search */}
      {projects.length > 3 && (
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={isZh ? '搜索项目...' : 'Search projects...'}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 text-red-400 text-sm bg-red-900/20 p-3 rounded-lg border border-red-500/20 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-white ml-4">&times;</button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
          <LoaderIcon className="w-6 h-6" />
          <span>{isZh ? '加载中...' : 'Loading projects...'}</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-20">
          {searchQuery ? (
            <>
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-slate-400">{isZh ? '没有匹配的项目' : 'No projects match your search'}</p>
              <button onClick={() => setSearchQuery('')} className="mt-3 text-indigo-400 hover:text-indigo-300 text-sm underline">
                {isZh ? '清除搜索' : 'Clear search'}
              </button>
            </>
          ) : (
            <>
              <p className="text-4xl mb-4">🎥</p>
              <p className="text-slate-300 font-semibold mb-2">
                {isZh ? '还没有项目' : 'No projects yet'}
              </p>
              <p className="text-slate-500 text-sm mb-6">
                {isZh ? '开始创作你的第一个 AI 电影项目' : 'Start creating your first AI cinematic project'}
              </p>
              <button
                onClick={onNewProject}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all"
              >
                {isZh ? '+ 创建第一个项目' : '+ Create First Project'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Project Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(project => {
            const sceneCount = project.scenes?.length ?? 0;
            const thumbnail = project.thumbnail || null;
            const isLoading = loadingId === project.id;
            const isDeleting = deletingId === project.id;

            return (
              <div
                key={project.id}
                className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-indigo-500/50 transition-all hover:shadow-lg hover:shadow-indigo-500/10"
              >
                {/* Thumbnail */}
                <div className="relative h-36 bg-slate-800 flex items-center justify-center overflow-hidden">
                  {thumbnail ? (
                    <img src={thumbnail} alt="" className="w-full h-full object-cover opacity-70" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/40 via-slate-900 to-purple-900/40 flex items-center justify-center">
                      <span className="text-4xl opacity-30">🎬</span>
                    </div>
                  )}
                  {/* Scene count badge */}
                  {sceneCount > 0 && (
                    <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full backdrop-blur-sm">
                      {sceneCount} {isZh ? '场景' : 'scenes'}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="font-bold text-white text-sm mb-1 truncate">
                    {getTitle(project) || (isZh ? '无标题项目' : 'Untitled Project')}
                  </h3>
                  {project.logline && (
                    <p className="text-xs text-slate-400 line-clamp-2 mb-3 leading-relaxed">
                      {project.logline}
                    </p>
                  )}
                  <p className="text-xs text-slate-600 mb-4">
                    {formatDate(project.updated_at || project.created_at)}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResume(project.id)}
                      disabled={isLoading || isDeleting}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 hover:border-indigo-400/60 text-indigo-300 text-xs font-semibold rounded-lg transition-all disabled:opacity-50"
                    >
                      {isLoading ? (
                        <LoaderIcon className="w-3.5 h-3.5" />
                      ) : (
                        <>
                          <span>▶</span>
                          {isZh ? '继续创作' : 'Resume'}
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(project.id)}
                      disabled={isLoading || isDeleting}
                      className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-50"
                      title={isZh ? '删除项目' : 'Delete project'}
                    >
                      {isDeleting ? (
                        <LoaderIcon className="w-3.5 h-3.5" />
                      ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                          <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reload button */}
      {!loading && (
        <div className="mt-6 text-center">
          <button
            onClick={loadProjects}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            ↻ {isZh ? '刷新' : 'Refresh'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ProjectDashboard;
