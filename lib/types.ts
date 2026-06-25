export type RelationshipClass = "oomf" | "safe" | "unsafe";
export type Source = "feed" | "notif" | "hydrant" | "custom-feed" | "manual";
export type ItemKind =
  | "post"
  | "reply"
  | "quote"
  | "mention"
  | "like"
  | "follow"
  | "repost"
  | "system";
export type Status =
  | "unseen"
  | "seen"
  | "ambient"
  | "acted"
  | "ignored"
  | "pending"
  | "handled";
export type Action =
  | "none"
  | "posted"
  | "quoted"
  | "replied"
  | "threaded"
  | "liked"
  | "followed"
  | "dismissed"
  | "noted";

export interface CachedPost {
  index: number;
  uri: string;
  cid: string;
  author: string;
  text: string;
  time: string;
  likes: number;
  replies: number;
  isRepost: boolean;
  repostedBy?: string;
}

export type ThreadContext = {
  parentUri?: string;
  parentAuthor?: string;
  threadRootUri?: string;
  rootAuthor?: string;
  upstreamAuthors: string[];
  upstreamRelationshipClasses: Record<string, RelationshipClass>;
  hasUnsafeUpstream: boolean;
};

export type FormattedFeedItem = {
  type: string;
  author: string | null;
  authorDid: string | null;
  text: string;
  time: string | null;
  likes: number;
  replies: number;
  uri: string;
  cid: string;
  parentUri: string | null;
  threadRootUri: string | null;
  replyTo: string | null;
  rootAuthor: string | null;
  upstreamAuthors: string[];
  upstreamRelationshipClasses: Record<string, RelationshipClass>;
  hasUnsafeUpstream: boolean;
};

export type FormattedNotifItem = {
  type: string;
  actor: string | null;
  actorDid: string | null;
  text: string;
  time: string | null;
  uri: string;
  cid: string | null;
  parentUri: string | null;
  threadRootUri: string | null;
  replyTo: string | null;
  rootAuthor: string | null;
  upstreamAuthors: string[];
  upstreamRelationshipClasses: Record<string, RelationshipClass>;
  hasUnsafeUpstream: boolean;
};

export type ScanItem = {
  uri: string;
  cid: string | null;
  source: Source;
  kind: ItemKind;
  author_handle: string | null;
  author_did: string | null;
  text: string | null;
  alt_text: string | null;
  created_at: string | null;
  indexed_at: string | null;
  thread_root_uri: string | null;
  parent_uri: string | null;
  reply_to: string | null;
  root_author: string | null;
  subject_uri: string | null;
  subject_cid: string | null;
  subject_did: string | null;
  subject_handle: string | null;
  upstream_safety: string | null;
  has_unsafe_upstream: number;
  needs_attention: number;
  raw_json: string;
};

export type ScanSummary = {
  scanned: number;
  inserted: number;
  updated: number;
  autoPending: number;
  autoSeen: number;
  db: string;
};

export type TrackedItemRow = {
  uri: string;
  cid: string | null;
  source: string;
  kind: string;
  author_handle: string | null;
  author_did: string | null;
  text: string | null;
  alt_text: string | null;
  created_at: string | null;
  indexed_at: string | null;
  thread_root_uri: string | null;
  parent_uri: string | null;
  reply_to: string | null;
  root_author: string | null;
  subject_uri: string | null;
  subject_cid: string | null;
  subject_did: string | null;
  subject_handle: string | null;
  upstream_safety: string | null;
  has_unsafe_upstream: number;
  needs_attention: number;
  status: string;
  action_taken: string;
  decision_note: string | null;
  last_decision_at: string | null;
  reply_uri: string | null;
  reply_cid: string | null;
  like_uri: string | null;
  like_cid: string | null;
  raw_json: string;
  first_seen_at: string;
  last_seen_at: string;
};

export type ManualItemSeed = Partial<ScanItem> & {
  uri: string;
  kind: ItemKind;
  status: Status;
  action: Action;
  note: string;
  like_uri?: string | null;
  like_cid?: string | null;
  reply_uri?: string | null;
  reply_cid?: string | null;
};
