"""Bounded lock map with LRU eviction for per-resource asyncio locks.

Prevents unbounded memory growth when locks are created per-session or
per-voicebank but never cleaned up.
"""

import asyncio
from collections import OrderedDict


class BoundedLockMap:
    """A bounded dictionary of asyncio.Lock instances with LRU eviction.

    Creates locks on demand per key (e.g., session ID, voicebank ID) and
    evicts the least-recently-used unlocked entries when the map exceeds
    its maximum capacity.

    Thread-safety note: This class is designed for single-threaded asyncio
    use. All access must happen on the same event loop.

    Args:
        max_size: Maximum number of locks to retain. When exceeded, unlocked
                  entries are evicted starting from the least recently used.
                  Defaults to 1024.
    """

    def __init__(self, max_size: int = 1024) -> None:
        if max_size < 1:
            raise ValueError(f"max_size must be >= 1, got {max_size}")
        self._max_size = max_size
        self._locks: OrderedDict[str, asyncio.Lock] = OrderedDict()

    def get(self, key: str) -> asyncio.Lock:
        """Get or create a lock for the given key.

        Moves the key to the most-recently-used position. If the map
        exceeds max_size after insertion, evicts unlocked LRU entries.

        Args:
            key: Resource identifier (e.g., session_id, voicebank_id)

        Returns:
            asyncio.Lock for the given key
        """
        if key in self._locks:
            self._locks.move_to_end(key)
            return self._locks[key]

        lock = asyncio.Lock()
        self._locks[key] = lock
        self._evict_if_needed()
        return lock

    def discard(self, key: str) -> None:
        """Remove a lock for the given key if it exists and is not held.

        Safe to call even if the key does not exist. Silently skips
        removal if the lock is currently held (to avoid breaking
        an in-progress critical section).

        Args:
            key: Resource identifier to remove
        """
        lock = self._locks.get(key)
        if lock is None:
            return
        if lock.locked():
            # Lock is currently held -- do not remove it.
            return
        del self._locks[key]

    def _evict_if_needed(self) -> None:
        """Evict unlocked LRU entries until size <= max_size.

        Only evicts entries whose lock is not currently held. If all
        entries are locked, the map is allowed to temporarily exceed
        max_size (this is safe because held locks will eventually be
        released and evicted on the next insertion).
        """
        if len(self._locks) <= self._max_size:
            return

        # Collect keys to evict (iterate oldest-first)
        keys_to_evict: list[str] = []
        for key, lock in self._locks.items():
            if len(self._locks) - len(keys_to_evict) <= self._max_size:
                break
            if not lock.locked():
                keys_to_evict.append(key)

        for key in keys_to_evict:
            del self._locks[key]

    def __len__(self) -> int:
        """Return the number of locks currently stored."""
        return len(self._locks)
