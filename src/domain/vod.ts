/**
 * Struttura catalogo VOD: Campionati passati → Anni → Gare → Sessioni / Onboard
 */

export type SessionType = 'race' | 'qualifying' | 'practice' | 'sprint' | 'show' | 'onboard' | 'other';

export type VodSession = {
  contentId: number;
  title: string;
  type: SessionType;
  channelId?: number;
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
  /** pageId F1 TV per caricare le sessioni in lazy load */
  pageId?: number;
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
