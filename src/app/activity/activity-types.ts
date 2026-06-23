export type ActivityResponse = {
  items: ActivityItem[];
};

export type ActivityItem = {
  id: string;
  kind: "Fetch" | "Summary" | "Archive" | "Sync" | "Source" | "System";
  severity: "Info" | "Warning" | "Error";
  title: string;
  message: string;
  occurredAt: string;
  retryable: boolean;
  technical: {
    kind: "job" | "outbox" | "source";
    id: string;
  };
};
