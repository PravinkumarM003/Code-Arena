// API response type definitions for CodeArena frontend

// Response from POST /admin/start
export interface StartContestResponse {
  success: boolean;
  /** Timestamp (ms since epoch) when the contest ends */
  endTime?: number;
  /** Unique identifier for the event */
  eventId?: string;
  /** Number of participants the contest started for */
  usersCount: number;
  /** Contest mode (individual or group) */
  mode: 'INDIVIDUAL' | 'GROUP';
  /** Optional error message when success is false */
  error?: string;
}
