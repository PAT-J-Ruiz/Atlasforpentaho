/**
 * execution-builder.js — Execution correlation engine (v2)
 *
 * Attribution order (PDI_LOG_ANALYSIS_SPECIFICATION.md §4):
 *  1. Thread   → direct to that thread's execution.
 *  2. UUID     → the open execution sharing the same root job whose
 *                interval contains the line's instant.
 *  3. Step     → same root-job + interval rule; ties broken by longest
 *                matching path-chain prefix. No candidate → retained.
 *
 * Only "Job execution finished" on a Thread closes an execution. No gap
 * timeout ever splits one (D5). Executions still open at EOF are
 * "incomplete", not errors.
 */

'use strict';

const PKAExecutionBuilder = (() => {

  const R = PKA_CONFIG.REGEX;

  // executionId → execution record (see shape below). Keyed as `EXEC_<thread>`,
  // which doubles as the thread→execution lookup for Level 1 attribution.
  let _executions = new Map();
  // rootJob → Set<executionId> of currently OPEN executions under that root
  let _openByRoot = new Map();
  // blocks retained because no candidate execution was open yet
  let _pending = [];

  let _opens  = 0;
  let _closes = 0;

  function reset() {
    _executions  = new Map();
    _openByRoot  = new Map();
    _pending     = [];
    _opens = 0;
    _closes = 0;
  }

  function _isLowConfidence(rootJob) {
    return !!rootJob && /\/null$/.test(rootJob);
  }

  function _newExecution(thread, rootJob, ts, pathChain) {
    const executionId = `EXEC_${thread}`;
    const exec = {
      executionId,
      rootJob,
      thread,
      pathChain: pathChain.slice(),
      startTime: ts,
      endTime:   ts,
      duration:  null,
      status:    'open',
      blockCount: 0,
      lowConfidence: _isLowConfidence(rootJob),
      hasError:  false,
      errorCount: 0,          // error INCIDENTS, not error lines (see recordError)
      firstErrorBlockId: null,
      firstErrorMessage: null,
    };
    _executions.set(executionId, exec);

    if (!_openByRoot.has(rootJob)) _openByRoot.set(rootJob, new Set());
    _openByRoot.get(rootJob).add(executionId);

    _opens++;
    return exec;
  }

  function _touch(exec, ts) {
    if (!ts) return;
    if (!exec.startTime || ts < exec.startTime) exec.startTime = ts;
    if (!exec.endTime   || ts > exec.endTime)   exec.endTime   = ts;
  }

  function _closeExecution(exec, ts) {
    exec.status  = 'complete';
    _touch(exec, ts);
    exec.duration = exec.endTime - exec.startTime;
    const set = _openByRoot.get(exec.rootJob);
    if (set) {
      set.delete(exec.executionId);
      if (set.size === 0) _openByRoot.delete(exec.rootJob);
    }
    _closes++;
  }

  function _longestPrefixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i;
  }

  /**
   * Finds the open execution(s) under `rootJob` whose interval contains ts.
   * Interval = [startTime, endTime-so-far] — an open execution's "so far"
   * end is treated as extending to ts itself (still running).
   */
  function _candidatesFor(rootJob, ts) {
    const set = _openByRoot.get(rootJob);
    if (!set || set.size === 0) return [];
    const out = [];
    for (const execId of set) {
      const exec = _executions.get(execId);
      if (!exec) continue;
      if (ts >= exec.startTime) out.push(exec);
    }
    return out;
  }

  /**
   * Attributes a single block. Returns the executionId, or null if the
   * block must be retained for a later retry.
   */
  function attributeBlock(block) {
    const msg = (block.headerLine && block.headerLine.message) || '';
    const rootJob = block.pathChain[0] || null;

    // Opening: "Start of job execution" on a Thread-identified block.
    if (block.identifierType === 'thread' && R.JOB_START.test(msg)) {
      let exec = _executions.get(`EXEC_${block.thread}`);
      if (!exec) exec = _newExecution(block.thread, rootJob, block.ts, block.pathChain);
      block.executionId = exec.executionId;
      exec.blockCount++;
      _touch(exec, block.ts);
      return exec.executionId;
    }

    // Level 1 — Thread: direct, unambiguous — but ONLY for threads that are
    // actually a job execution root (i.e. we saw their "Start of job
    // execution"). Not every Thread-N identifier is a root: e.g. an
    // "Execute a process" step logs its subprocess stdout under its own
    // <Thread-N> identifier that never opens or closes a job execution.
    // Defensively creating an execution for those threads made them
    // zombies — since they never close, they stayed "open" forever and
    // absorbed every later step-line of the same root job for the rest of
    // the file. Such threads fall through to the same root-job + window
    // attribution used for step/UUID lines instead.
    if (block.identifierType === 'thread') {
      const exec = _executions.get(`EXEC_${block.thread}`);
      if (exec) {
        block.executionId = exec.executionId;
        exec.blockCount++;
        _touch(exec, block.ts);
        return exec.executionId;
      }
    }

    // Level 2 (UUID) / Level 3 (step, and orphan Thread-N lines): attribute
    // by root job + time window, qualifying with the FULL path-chain, never
    // just the last element.
    let candidates = _candidatesFor(rootJob, block.ts);

    if (candidates.length === 0) {
      block.lowConfidence = _isLowConfidence(rootJob);
      return null; // retained for retry
    }

    let winner = candidates[0];
    if (candidates.length > 1) {
      let bestLen = -1;
      for (const c of candidates) {
        const len = _longestPrefixLen(c.pathChain, block.pathChain);
        if (len > bestLen) { bestLen = len; winner = c; }
      }
    }

    block.executionId = winner.executionId;
    block.lowConfidence = winner.lowConfidence;
    winner.blockCount++;
    _touch(winner, block.ts);
    return winner.executionId;
  }

  /** Detects the closing message on a Thread-identified block. */
  function isCloseBlock(block) {
    const msg = (block.headerLine && block.headerLine.message) || '';
    return block.identifierType === 'thread' && /Job execution finished/i.test(msg);
  }

  /**
   * Full per-block driver: opens/closes as needed, then attributes.
   * Retains unattributable blocks in `_pending` for a later retryPending().
   */
  function processBlock(block) {
    const executionId = attributeBlock(block);

    if (block.identifierType === 'thread') {
      const exec = _executions.get(`EXEC_${block.thread}`);
      if (exec && isCloseBlock(block) && exec.status === 'open') {
        _closeExecution(exec, block.ts);
      }
    }

    if (executionId === null) {
      _pending.push(block);
      return null;
    }
    return executionId;
  }

  /** Retries all pending blocks; still-unattributable ones stay pending. */
  function retryPending() {
    const stillPending = [];
    for (const block of _pending) {
      const executionId = attributeBlock(block);
      if (executionId === null) stillPending.push(block);
    }
    _pending = stillPending;
    return _pending.length;
  }

  /** Marks unattributable remaining pending blocks as orphaned; call at EOF. */
  function finalizePending() {
    for (const block of _pending) {
      block.anomaly = block.anomaly ? block.anomaly : 'unattributed';
      block.executionId = null;
    }
    const orphaned = _pending;
    _pending = [];
    return orphaned;
  }

  /** Marks still-open executions as incomplete at EOF. */
  function finalizeExecutions() {
    for (const exec of _executions.values()) {
      if (exec.status === 'open') {
        exec.status = 'incomplete';
        exec.duration = (exec.endTime && exec.startTime) ? exec.endTime - exec.startTime : null;
      }
      delete exec.pathChain; // internal-only, not persisted
    }
  }

  /**
   * Records one error INCIDENT against an execution. The caller only calls
   * this on the first error block of a consecutive run, so a 40-line stack
   * trace counts as one incident, not 40. Safe with a null executionId.
   */
  function recordError(executionId, blockId, message) {
    if (!executionId) return;
    const exec = _executions.get(executionId);
    if (!exec) return;
    exec.hasError = true;
    exec.errorCount = (exec.errorCount || 0) + 1;
    if (!exec.firstErrorBlockId) {
      exec.firstErrorBlockId = blockId;
      exec.firstErrorMessage = message || null;
    }
  }

  function getExecutions() {
    return Array.from(_executions.values());
  }

  function getStats() {
    let incomplete = 0, withError = 0;
    for (const exec of _executions.values()) {
      if (exec.status === 'incomplete') incomplete++;
      if (exec.hasError) withError++;
    }
    return { opens: _opens, closes: _closes, incomplete, withError, pending: _pending.length };
  }

  return {
    reset, processBlock, retryPending, finalizePending, finalizeExecutions,
    recordError, getExecutions, getStats,
  };
})();

if (typeof window !== 'undefined') window.PKAExecutionBuilder = PKAExecutionBuilder;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAExecutionBuilder = PKAExecutionBuilder;
