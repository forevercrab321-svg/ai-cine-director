
import React, { useState, useCallback } from 'react';
import { CopyIcon, CheckIcon } from './IconComponents';

interface CopyButtonProps {
  text: string;
  label?: string;
  fullWidth?: boolean;
}

const CopyButton: React.FC<CopyButtonProps> = ({ text, label = "Copy", fullWidth = false }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`
        flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200
        ${fullWidth ? 'w-full' : ''}
        ${copied 
          ? 'bg-green-500/20 text-green-400 border border-green-500/50' 
          : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 hover:border-slate-500'}
      `}
    >
      {copied ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-4 h-4" />}
      {copied ? 'Copied!' : label}
    </button>
  );
};

export default CopyButton;
