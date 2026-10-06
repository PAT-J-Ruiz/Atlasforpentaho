/**
 * deduplicator.js — Block-level sliding-window deduplication
 *
 * The log is written by two concurrent appenders: every real block appears
 * exactly twice, with a timestamp gap of up to ~3.6s, interleaved with
 * unrelated blocks (never adjacent). Deduplication is therefore never a
 * unicity collapse and never a comparison with the previous line — it is an
 * exact pairing within a bounded window.
 * See PDI_LOG_ANALYSIS_SPECIFICATION.md §8.
 */

'use strict';

const PKADeduplicator = (() => {

  // FIFO of { key, block } entries not yet paired.
  let _window = [];
  let _pairsEmitted    = 0;
  let _unmatchedEmitted = 0;

  // The window is bounded by the log's OWN timestamps (not wall-clock
  // processing time), since blocks are consumed in file order and the file
  // is a single pass — using real elapsed time would make the window's
  // effective size depend on I/O speed instead of log content.
  let _latestTs = 0;

  /**
   * Content key excluding the timestamp — identifier, path-chain and full
   * block text (header + continuation) determine identity.
   */
  function _contentKey(block) {
    return [
      block.identifierType || '',
      block.headerLine ? block.headerLine.identifier || '' : '',
      block.pathChain.join('\u0001'),
      block.headerLine ? block.headerLine.level || '' : '',
      block.headerLine ? block.headerLine.message || '' : '',
      block.continuationRaw.join('\u0001'),
    ].join('\u0002');
  }

  function _purgeExpired(emit) {
    while (_window.length > 0) {
      const oldest = _window[0];
      const overCount = _window.length > PKA_CONFIG.DEDUP_WINDOW_COUNT;
      const overTime  = (_latestTs - oldest.block.ts) > PKA_CONFIG.DEDUP_WINDOW_MS;
      if (!overCount && !overTime) break;

      _window.shift();
      oldest.block.anomaly = 'unmatched';
      _unmatchedEmitted++;
      emit(oldest.block);
    }
  }

  /**
   * Submit a closed block. May synchronously emit zero, one or two blocks
   * via `emit(block)` (the purge of expired unmatched entries can fire
   * alongside the pairing result).
   */
  function submitBlock(block, emit) {
    if (block.ts) _latestTs = Math.max(_latestTs, block.ts);

    const key = _contentKey(block);

    const idx = _window.findIndex(e => e.key === key);
    if (idx !== -1) {
      const [match] = _window.splice(idx, 1);
      // Keep the smaller timestamp — the copy that arrives first is not
      // always the one with the smaller ts (log is not monotonic).
      const winner = (block.ts && match.block.ts && match.block.ts < block.ts) ? match.block : block;
      winner.blockId = block.blockId; // preserve identity of the later-arriving block's id for downstream refs
      _pairsEmitted++;
      emit(winner);
    } else {
      _window.push({ key, block });
    }

    _purgeExpired(emit);
  }

  /** Flush all remaining unmatched blocks at end of stream. */
  function flush(emit) {
    for (const entry of _window) {
      entry.block.anomaly = 'unmatched';
      _unmatchedEmitted++;
      emit(entry.block);
    }
    _window = [];
  }

  function getStats() {
    return { pairsEmitted: _pairsEmitted, unmatchedEmitted: _unmatchedEmitted };
  }

  function reset() {
    _window = [];
    _pairsEmitted = 0;
    _unmatchedEmitted = 0;
  }

  return { submitBlock, flush, getStats, reset };
})();

if (typeof window !== 'undefined') window.PKADeduplicator = PKADeduplicator;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKADeduplicator = PKADeduplicator;
