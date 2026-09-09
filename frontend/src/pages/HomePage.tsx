import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';

export default function HomePage() {
  const navigate = useNavigate();

  const handleEnterContest = () => {
    navigate('/contest');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-purple-600 to-indigo-800 text-white p-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <Users className="w-10 h-10 text-white" />
        <h1 className="text-5xl font-extrabold tracking-tight">CodeArena</h1>
      </div>
      <p className="text-lg text-white/80 max-w-md text-center mb-8">
        Competitive coding platform with real‑time contests. Form a team, solve problems, and climb the leaderboard.
      </p>
      <button
        onClick={handleEnterContest}
        className="px-6 py-3 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition-colors text-white font-semibold flex items-center gap-2 shadow-lg shadow-purple-500/30"
      >
        Enter Contest
      </button>
    </div>
  );
}
