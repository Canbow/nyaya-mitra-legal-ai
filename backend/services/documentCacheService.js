'use strict';

/**
 * @file services/documentCacheService.js
 * @description In-memory caching service for document analysis results.
 *
 * Caches:
 *   - Document analysis results by doc_id
 *   - Cache expiration (TTL)
 *   - Maximum 1000 cached documents (LRU eviction)
 *
 * Usage:
 *   const cached = cache.get(docId);
 *   if (cached) return cached;
 *   
 *   const result = await analyzeDocument(...);
 *   cache.set(docId, result);
 */

// ---------------------------------------------------------------------------
// In-Memory Cache with LRU Eviction and TTL
// ---------------------------------------------------------------------------

class DocumentCache {
  constructor(maxSize = 1000, ttlMs = 3600000) { // 1 hour default
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.accessOrder = []; // Track insertion order for LRU
  }

  /**
   * Get a cached document result.
   *
   * @param {string} docId - The document UUID
   * @returns {Object|null} Cached analysis or null if expired/not found
   */
  get(docId) {
    if (!this.cache.has(docId)) return null;

    const entry = this.cache.get(docId);
    const now = Date.now();

    // Check if expired
    if (entry.expiresAt && now > entry.expiresAt) {
      this.cache.delete(docId);
      return null;
    }

    // Move to end of access order (most recently used)
    this.accessOrder = this.accessOrder.filter(id => id !== docId);
    this.accessOrder.push(docId);

    return entry.data;
  }

  /**
   * Set a cached document result.
   *
   * @param {string} docId - The document UUID
   * @param {Object} data - The analysis result to cache
   */
  set(docId, data) {
    if (this.cache.has(docId)) {
      // Update existing entry
      this.accessOrder = this.accessOrder.filter(id => id !== docId);
      this.accessOrder.push(docId);
      this.cache.set(docId, {
        data,
        expiresAt: Date.now() + this.ttlMs,
      });
      return;
    }

    // Add new entry
    if (this.cache.size >= this.maxSize) {
      // Evict least recently used (oldest in accessOrder)
      const lruId = this.accessOrder.shift();
      this.cache.delete(lruId);
      console.log(`[documentCache] Evicted LRU entry: ${lruId}`);
    }

    this.accessOrder.push(docId);
    this.cache.set(docId, {
      data,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Clear the entire cache.
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
    console.log('[documentCache] Cache cleared');
  }

  /**
   * Get cache statistics.
   *
   * @returns {Object} Statistics including size, max size, and hit ratio
   */
  getStats() {
    const validEntries = Array.from(this.cache.entries()).filter(([_, entry]) => {
      return !entry.expiresAt || Date.now() <= entry.expiresAt;
    });

    return {
      size: validEntries.length,
      maxSize: this.maxSize,
      ttlSeconds: Math.round(this.ttlMs / 1000),
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton Instance
// ---------------------------------------------------------------------------

const cache = new DocumentCache(1000, 3600000); // 1000 entries, 1 hour TTL

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  cache,
  DocumentCache,
};
