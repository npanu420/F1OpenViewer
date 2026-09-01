/**
 * VOD catalog shape: past championships -> years -> events -> sessions / onboard
 */

export type SessionType = 'race' | 'qualifying' | 'practice' | 'sprint' | 'show' | 'onboard' | 'other';

export type VodSession = {
  contentId: number;
  title: string;
  type: SessionType;
  channelId?: number;
  /** Racing series for this session. Defaults to F1. */
  series?: string;
};

export type VodOnboard = {
  contentId: number;
  channelId: number;
  title: string;
  driverName?: string;
  teamName?: string;
  racingNumber?: number;
};

export type VodEvent = {
  meetingKey: string;
  meetingName: string;
  meetingNumber: number;
  country?: string;
  /** F1 TV pageId for lazy-loading sessions */
  pageId?: number;
  /** Whether this entry is pre-season testing. */
  isTest?: boolean;
  sessions: VodSession[];
  onboard: VodOnboard[];
};

export type VodSeason = {
  year: number;
  events: VodEvent[];
};

export type VodCatalog = {
  seasons: VodSeason[];
};
