
import { useEffect, useState } from "react";
import { replicateQueue, QueueUpdate } from "../lib/replicateQueue";

export function useReplicateQueueStatus() {
  const [updates, setUpdates] = useState<Record<string, QueueUpdate>>({});

  useEffect(() => {
    return replicateQueue.onUpdate((u) => {
      setUpdates((prev) => ({ ...prev, [u.id]: u }));
    });
  }, []);

  return updates;
}
