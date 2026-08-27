import { useState, useEffect, useCallback } from 'react';
import { Users, Search, UserPlus, Check, X, Crown, Shield, Loader2, UserMinus, Trash2, Mail } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useContest } from '../contexts/ContestContext';
import toast from 'react-hot-toast';

interface TeamMember {
  id: string;
  userId: string;
  status: string;
  user: { id: string; name: string; email: string };
}

interface Team {
  id: string;
  name: string;
  captainId: string;
  captain: { id: string; name: string; email: string };
  members: TeamMember[];
}

interface SearchUser {
  id: string;
  name: string;
  email: string;
  inTeam: boolean;
}

interface PendingInvite {
  id: string;
  team: { id: string; name: string };
  inviter: { id: string; name: string };
}

export default function TeamFormation() {
  const { user } = useAuth();
  const { teamInvites } = useContest();
  // currentUserDbId is resolved from team membership so we compare DB IDs, not Firebase UIDs
  const [currentUserDbId, setCurrentUserDbId] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const fetchMyTeam = useCallback(async () => {
    try {
      const res = await api.get('/teams/my-team');
      const fetchedTeam: Team | null = res.data.team;
      setTeam(fetchedTeam);
      // Resolve the current user's DB ID from team membership using email match
      if (fetchedTeam && user?.email) {
        const myMembership = fetchedTeam.members.find(
          (m) => m.user.email === user.email
        );
        if (myMembership) setCurrentUserDbId(myMembership.user.id);
      }
    } catch (err) {
      console.error('Failed to fetch team', err);
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  const fetchInvites = useCallback(async () => {
    try {
      const res = await api.get('/teams/invites');
      setPendingInvites(res.data.invites || []);
    } catch (err) {
      console.error('Failed to fetch invites', err);
    }
  }, []);

  useEffect(() => {
    fetchMyTeam();
    fetchInvites();
  }, [fetchMyTeam, fetchInvites]);

  // Refresh on socket invite events
  useEffect(() => {
    fetchInvites();
  }, [teamInvites, fetchInvites]);

  // Search users
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/teams/search-users?q=${encodeURIComponent(searchQuery)}`);
        // Filter out the current user so the captain cannot invite themselves
        const results: SearchUser[] = (res.data.users || []).filter(
          (u: SearchUser) => u.id !== currentUserDbId && u.email !== user?.email
        );
        setSearchResults(results);
      } catch (err) {
        console.error('Search failed', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, currentUserDbId, user?.email]);

  const handleCreateTeam = async () => {
    if (!teamName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post('/teams/create', { name: teamName.trim() });
      const newTeam: Team = res.data.team;
      setTeam(newTeam);
      // After creating, resolve currentUserDbId from team membership
      if (user?.email) {
        const myMembership = newTeam.members.find((m) => m.user.email === user.email);
        if (myMembership) setCurrentUserDbId(myMembership.user.id);
      }
      setTeamName('');
      toast.success('Team created! You are the captain 🏆');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create team');
    } finally {
      setCreating(false);
    }
  };

  const handleInvite = async (userId: string) => {
    setInvitingId(userId);
    try {
      await api.post('/teams/invite', { inviteeId: userId });
      toast.success('Invite sent!');
      setSearchResults((prev) => prev.map((u) => u.id === userId ? { ...u, inTeam: true } : u));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to send invite');
    } finally {
      setInvitingId(null);
    }
  };

  const handleRespond = async (inviteId: string, accept: boolean) => {
    setRespondingId(inviteId);
    try {
      const res = await api.post('/teams/respond', { inviteId, accept });
      if (accept && res.data.team) {
        const joinedTeam: Team = res.data.team;
        setTeam(joinedTeam);
        // Resolve currentUserDbId from the joined team
        if (user?.email) {
          const myMembership = joinedTeam.members.find((m) => m.user.email === user.email);
          if (myMembership) setCurrentUserDbId(myMembership.user.id);
        }
        toast.success('You joined the team! 🎉');
      } else {
        toast('Invite declined');
      }
      setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to respond');
    } finally {
      setRespondingId(null);
    }
  };

  const handleLeave = async () => {
    try {
      await api.post('/teams/leave');
      setTeam(null);
      setCurrentUserDbId(null);
      toast.success('You left the team');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to leave team');
    }
  };

  const handleDisband = async () => {
    if (!team) return;
    if (!confirm('Are you sure you want to disband the team? This cannot be undone.')) return;
    try {
      await api.delete(`/teams/${team.id}`);
      setTeam(null);
      setCurrentUserDbId(null);
      toast.success('Team disbanded');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to disband team');
    }
  };

  // Compare DB IDs — captainId is a cuid, user.uid is a Firebase UID (different!)
  const isCaptain = !!team && !!currentUserDbId && team.captainId === currentUserDbId;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-2xl shadow-purple-500/30 mb-3">
          <Users className="w-7 h-7 text-white" />
        </div>
        <h2 className="text-2xl font-black text-white">Team Formation</h2>
        <p className="text-white/40 text-sm mt-1">Form a team of 4 members before the contest starts</p>
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && !team && (
        <div className="glass-card p-5 border-purple-500/30 bg-purple-500/5">
          <div className="flex items-center gap-2 mb-3">
            <Mail className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wider">Pending Invites</h3>
          </div>
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3">
                <div>
                  <p className="text-white font-semibold text-sm">{invite.team.name}</p>
                  <p className="text-white/40 text-xs">from {invite.inviter.name}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRespond(invite.id, true)}
                    disabled={respondingId === invite.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 transition-all"
                  >
                    {respondingId === invite.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Accept
                  </button>
                  <button
                    onClick={() => handleRespond(invite.id, false)}
                    disabled={respondingId === invite.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition-all"
                  >
                    <X className="w-3 h-3" />
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Team — Create Team Form */}
      {!team && (
        <div className="glass-card p-6">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-brand-400" />
            Create a Team
          </h3>
          <div className="flex gap-3">
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Enter team name..."
              maxLength={50}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 transition-all"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTeam()}
            />
            <button
              onClick={handleCreateTeam}
              disabled={!teamName.trim() || creating}
              className="btn-primary px-5 py-3 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Has Team — Team Info */}
      {team && (
        <div className="glass-card p-6 border-brand-500/20 bg-brand-500/5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider font-semibold">Your Team</p>
              <h3 className="text-xl font-black text-white mt-0.5">{team.name}</h3>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20">
              <Users className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-brand-400 text-sm font-bold">{team.members.length}/4</span>
            </div>
          </div>

          {/* Members */}
          <div className="space-y-2 mb-5">
            {team.members.map((member) => (
              <div key={member.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">{member.user.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{member.user.name}</p>
                  <p className="text-white/30 text-xs truncate">{member.user.email}</p>
                </div>
                {member.user.id === team.captainId && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-semibold">
                    <Crown className="w-3 h-3" /> Captain
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Team Actions — shown based on whether the current user is the captain */}
          <div className="flex gap-3">
            {isCaptain ? (
              /* Captain sees disband */
              <button
                onClick={handleDisband}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold hover:bg-red-500/20 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" /> Disband Team
              </button>
            ) : (
              /* Non-captain sees leave */
              <button
                onClick={handleLeave}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/50 text-sm font-semibold hover:bg-white/10 transition-all"
              >
                <UserMinus className="w-3.5 h-3.5" /> Leave Team
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search & Invite Users (Captain only, team not full) */}
      {team && isCaptain && team.members.length < 4 && (
        <div className="glass-card p-6">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-400" />
            Invite Members
          </h3>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 transition-all"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-400 animate-spin" />
            )}
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar">
              {searchResults.map((u) => (
                <div key={u.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">{u.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{u.name}</p>
                    <p className="text-white/30 text-xs truncate">{u.email}</p>
                  </div>
                  {u.inTeam ? (
                    <span className="text-white/30 text-xs font-medium">In a team</span>
                  ) : (
                    <button
                      onClick={() => handleInvite(u.id)}
                      disabled={invitingId === u.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-500/20 border border-brand-500/30 text-brand-400 text-xs font-semibold hover:bg-brand-500/30 transition-all disabled:opacity-40"
                    >
                      {invitingId === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                      Add
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
            <p className="text-white/30 text-sm text-center py-4">No users found</p>
          )}
        </div>
      )}
    </div>
  );
}
