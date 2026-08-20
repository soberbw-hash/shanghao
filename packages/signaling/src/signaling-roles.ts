export const SIGNALING_ROLES = {
  httpHealthIce: { owner: "SignalingServer", stateful: false },
  authentication: { owner: "SessionTokenStore", stateful: true },
  validationAndRateLimit: { owner: "SignalingServer", stateful: true },
  socketSessions: { owner: "SignalingServer", stateful: true },
  joinResumeMembers: { owner: "RoomManager", stateful: true },
  peerRouting: { owner: "PeerManager", stateful: true },
  chat: { owner: "ChatHistoryStore", stateful: true },
  collection: { owner: "RoomCollectionStore", stateful: true },
  dailyReports: { owner: "DailyRoomReportStore", stateful: true },
  snapshotsAndBroadcast: { owner: "SignalingServer", stateful: false },
  backpressure: { owner: "SignalingServer", stateful: true },
} as const;

export type SignalingRole = keyof typeof SIGNALING_ROLES;
