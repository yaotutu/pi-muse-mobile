export type InformationSettings = {
  enabled: boolean;
  batchWindowSeconds: number;
};

export type InformationFeedbackItem = {
  id: string;
  source: string;
  title?: string;
  content: string;
  contentTruncated: boolean;
};

export type InformationFeedbackExample = {
  runId: string;
  notificationId: string;
  text: string;
  reaction: 'like' | 'dislike' | null;
  comments: string[];
  commentsTruncated: boolean;
  items: InformationFeedbackItem[];
};

export type InformationPreferences = {
  notes: string;
  feedbackExamples: InformationFeedbackExample[];
};

export type InformationInputItem = {
  source: string;
  externalId: string;
  content: string;
  title?: string;
  receivedAt?: string;
};

export type InformationItemStatus = 'pending' | 'processing' | 'processed' | 'failed';

export type InformationItem = {
  id: string;
  spaceId: string;
  source: string;
  externalId: string;
  title?: string;
  content: string;
  receivedAt: string;
  acceptedAt: string;
  status: InformationItemStatus;
  runId?: string;
};

export type InformationItemsQuery = {
  limit?: number;
  cursor?: string;
  status?: InformationItemStatus;
};

export type InformationItemsPage = {
  items: InformationItem[];
  nextCursor?: string;
};
