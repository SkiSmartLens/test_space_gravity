// In-memory FIFO matchmaking. Simplification: ranked mode pairs whoever has
// been waiting longest rather than doing real MMR-bucketed matching -- fine
// for a prototype's player counts, called out as a known simplification.

const queues = { public: [], ranked: [] };

export function joinQueue(mode, entry) {
  leaveQueues(entry.playerId);
  const queue = queues[mode];
  queue.push(entry);
  if (queue.length >= 2) {
    return [queue.shift(), queue.shift()];
  }
  return null;
}

export function leaveQueues(playerId) {
  for (const mode of Object.keys(queues)) {
    queues[mode] = queues[mode].filter((e) => e.playerId !== playerId);
  }
}

export function queueSizes() {
  return { public: queues.public.length, ranked: queues.ranked.length };
}
