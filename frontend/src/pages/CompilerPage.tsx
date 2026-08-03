import React from 'react';
import { ArrowLeft, Code2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import OnlineGDBCompiler from '../components/OnlineGDBCompiler';

export default function CompilerPage() {
  return (
    <div className="h-screen flex flex-col bg-surface-950 overflow-hidden font-sans">
      {/* Top Banner */}
      <header className="flex items-center justify-between px-4 py-1.5 border-b border-white/10 bg-[#161b22] text-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="Back to Platform"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center">
              <Code2 className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-white text-sm font-mono tracking-wide">
              OnlineGDB Compiler & IDE
            </span>
          </div>
        </div>

        <div className="text-xs text-white/40 font-mono hidden sm:block">
          Multi-Language Online IDE • Powered by Piston
        </div>
      </header>

      {/* Compiler Component in Standalone Mode */}
      <div className="flex-1 overflow-hidden">
        <OnlineGDBCompiler />
      </div>
    </div>
  );
}
