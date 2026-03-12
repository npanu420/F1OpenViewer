export type ContentKind = 'live' | 'replay' | 'show';

export type CatalogItem = {
  id: string;
  title: string;
  kind: ContentKind;
  season?: string;
  round?: string;
  /** F1 TV content ID (required for playback) */
  contentId: number;
  /** Optional channel ID for live streams */
  channelId?: number;
  meetingKey?: string;
  sessionKey?: string;
};

