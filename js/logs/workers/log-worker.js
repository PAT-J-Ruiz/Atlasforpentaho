/**
 * log-worker.js — Primary Web Worker
 *
 * Receives: { type: 'START', file: File }
 * Posts back:
 *   { type: 'PROGRESS', pct, linesProcessed, bytesRead, totalBytes }
 *   { type: 'DONE',     stats }
 *   { type: 'ERROR',    message }
 *
 * Pipeline order (PDI_LOG_ANALYSIS_SPECIFICATION.md §8.5 / §10), strict:
 *   1. Recognize headers and accumulate blocks.
 *   2. Deduplicate blocks in a sliding window.
 *   3. Attribute blocks to executions.
 *   4. Run domain parsers (jobs/trfs/vars/errors/metrics/deps) per block.
 * Single pass, bounded state — no sorting, no loading the file in memory.
 */

'use strict';

// Atlas: this file runs either as a Web Worker (served over http, e.g. Live Server)
// or loaded as a plain script in the page (opened from disk), where the same
// modules are already loaded and progress goes to window.__pkaPost.
const IS_WORKER = typeof importScripts === 'function' && typeof window === 'undefined';

if (IS_WORKER) {
  importScripts(
    '../config.js',
    '../core/normalizer.js',
    '../core/block-builder.js',
    '../core/deduplicator.js',
    '../core/parser.js',
    '../core/storage.js',
    '../core/execution-builder.js',
    '../core/error-detector.js',
    '../parsers/pentaho-parser.js',
    '../parsers/variable-parser.js',
    '../parsers/error-parser.js',
    '../parsers/metrics-parser.js',
    '../parsers/file-parser.js',
  );
}

function _post(msg) {
  if (IS_WORKER) self.postMessage(msg);
  else if (typeof window !== 'undefined' && window.__pkaPost) window.__pkaPost(msg);
}

/** Known warnings edited in Atlas → Configuración arrive as regex source strings. */
function _applyKnownWarnings(list) {
  if (!Array.isArray(list)) return;
  const res = [];
  for (const s of list) { try { res.push(new RegExp(s, 'i')); } catch (e) { /* invalid pattern: ignored */ } }
  PKA_CONFIG.KNOWN_WARNINGS.length = 0;
  PKA_CONFIG.KNOWN_WARNINGS.push(...res);
}

async function pkaRun(file, options = {}) {
  try {
    _applyKnownWarnings(options.knownWarnings);
    await processFile(file, options);
  } catch (err) {
    _post({ type: 'ERROR', message: err.message || String(err) });
  }
}

if (IS_WORKER) {
  self.onmessage = (e) => {
    const { type, file, options = {} } = e.data;
    if (type === 'START') pkaRun(file, options);
  };
}

/** Finds the most specific open job/trf whose path-chain is a prefix of `pathChain`. */
function _findEnclosing(openMap, pathChain) {
  let best = null, bestLen = -1;
  for (const entry of openMap.values()) {
    const p = entry.path;
    if (!p || p.length > pathChain.length) continue;
    let matches = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i] !== pathChain[i]) { matches = false; break; }
    }
    if (matches && p.length > bestLen) { bestLen = p.length; best = entry; }
  }
  return best;
}

// ── Main pipeline ────────────────────────────────────────────────────────────
async function processFile(file, options) {

  // Reset all stateful modules
  PKABlockBuilder.reset();
  PKADeduplicator.reset();
  PKAExecutionBuilder.reset();
  await PKAStorage.open();

  // Clear previous data if requested (default: true)
  if (options.clearPrevious !== false) {
    await PKAStorage.clearAll();
  }

  // ── Accumulators ────────────────────────────────────────────────────────
  const openJobs      = new Map();   // pathKey → open Job
  const openTrfs       = new Map();   // pathKey → open Transformation
  const jobs          = [];
  const trfs           = [];
  const variables      = [];
  const errors         = [];
  const metrics        = [];
  const dependencies   = [];
  const depSeen        = new Map();
  const blockRecords   = [];
  const pendingDomain  = []; // blocks not yet attributed to an execution
  const lastBlockWasError = new Map(); // executionId → bool, to group error runs into incidents

  /** Short, human-readable text of an error block — the first line that
   * actually carries the failure signal, for previews in the Errors view. */
  function _errorPreview(block) {
    const candidates = [block.headerLine.message, ...block.continuationRaw];
    const hit = candidates.find(t => t && PKAErrorDetector.isErrorText(null, t))
      || block.headerLine.message || '';
    return hit.trim().slice(0, 300);
  }

  // ── Line-level contrasts (spec §10 step 8) ──────────────────────────────
  let totalLines       = 0;
  let headerLines       = 0;
  let continuationLines = 0;
  let emptyLines        = 0;

  let prevError    = null;
  let lastProgress = Date.now();

  function toBlockRecord(block) {
    return {
      blockId:        block.blockId,
      executionId:    block.executionId || null,
      pathChain:      block.pathChain,
      depth:          block.pathChain.length,
      ts:             block.ts,
      identifier:     block.headerLine.identifier || '',
      level:          block.headerLine.level || '',
      message:        block.headerLine.message || '',
      headerRaw:      block.headerLine.raw,
      continuationRaw: block.continuationRaw,
      startLineNo:    block.startLineNo,
      endLineNo:      block.endLineNo,
      identifierType: block.identifierType,
      anomaly:        block.anomaly || null,
      lowConfidence:  !!block.lowConfidence,
      isError:        !!block.isError,
    };
  }

  function runDomainParsers(block, executionId) {
    const header = block.headerLine;

    // Consecutive error blocks of one execution (an error message followed
    // by its stack trace) are a single incident — only the first block of
    // each run is recorded, so counts reflect failures, not trace lines.
    const isErr = PKAErrorDetector.checkBlock(block);
    if (isErr) block.isError = true;
    if (executionId) {
      if (isErr && !lastBlockWasError.get(executionId)) {
        PKAExecutionBuilder.recordError(executionId, block.blockId, _errorPreview(block));
      }
      lastBlockWasError.set(executionId, isErr);
    }

    const ctxJob = _findEnclosing(openJobs, header.pathChain);
    const ctxTrf = _findEnclosing(openTrfs, header.pathChain);

    PKAPentahoParser.parseLine(header, openJobs, openTrfs, jobs, trfs, executionId);
    PKAVariableParser.parseLine(header, variables, executionId);
    prevError = PKAErrorParser.parseLine(
      header, prevError, errors, executionId,
      ctxJob ? ctxJob.name : null,
      ctxTrf ? ctxTrf.name : null
    );
    if (ctxTrf) {
      PKAMetricsParser.parseLine(header, metrics, executionId, ctxTrf.name, ctxTrf.start);
    }
    PKAFileParser.parseLine(header, depSeen, dependencies, executionId);

    // Continuation lines: only error-parser consumes them (stack traces).
    for (const rawText of block.continuationRaw) {
      const contLine = { isContinuation: true, raw: rawText };
      prevError = PKAErrorParser.parseLine(contLine, prevError, errors, executionId, null, null);
    }
  }

  function sweepPending() {
    for (let i = pendingDomain.length - 1; i >= 0; i--) {
      const b = pendingDomain[i];
      if (b.executionId) {
        runDomainParsers(b, b.executionId);
        blockRecords.push(toBlockRecord(b));
        pendingDomain.splice(i, 1);
      }
    }
  }

  function handleDedupedBlock(block) {
    const executionId = PKAExecutionBuilder.processBlock(block);
    if (executionId) {
      runDomainParsers(block, executionId);
      blockRecords.push(toBlockRecord(block));
    } else {
      pendingDomain.push(block);
    }
    PKAExecutionBuilder.retryPending();
    sweepPending();
  }

  // Reading the file is only the first part of the work — organizing the
  // results and saving them to the database take real time too on large
  // files, so the overall bar is split into three stages the UI can name.
  function postPhase(phase, pct) {
    _post({ type: 'PROGRESS', pct, phase, linesProcessed: totalLines });
  }

  // ── Stream ───────────────────────────────────────────────────────────────
  for await (const rawLine of PKAParser.stream(file, (bytesRead, totalBytes) => {
    const now = Date.now();
    if (now - lastProgress >= PKA_CONFIG.PROGRESS_INTERVAL) {
      lastProgress = now;
      const pct = totalBytes > 0 ? Math.round((bytesRead / totalBytes) * 70) : 0;
      postPhase('reading', pct);
    }
  })) {

    totalLines++;
    if (rawLine.isEmpty) emptyLines++;
    else if (rawLine.isContinuation) continuationLines++;
    else headerLines++;

    const line = PKANormalizer.normalizeLine(rawLine);

    // 1. Accumulate into blocks (a returned block means the previous one closed)
    const closedBlock = PKABlockBuilder.pushLine(line);
    if (closedBlock) {
      // 2. Deduplicate in window
      PKADeduplicator.submitBlock(closedBlock, handleDedupedBlock);
    }
  }

  // Flush the last open block
  const lastBlock = PKABlockBuilder.flush();
  if (lastBlock) {
    PKADeduplicator.submitBlock(lastBlock, handleDedupedBlock);
  }

  postPhase('organizing', 72);

  // Flush the dedup window — any block still waiting for its pair is an anomaly.
  PKADeduplicator.flush(handleDedupedBlock);

  // Final retry pass for anything still unattributed, then mark orphans.
  PKAExecutionBuilder.retryPending();
  sweepPending();
  const orphaned = PKAExecutionBuilder.finalizePending();
  for (const block of orphaned) {
    runDomainParsers(block, null);
    blockRecords.push(toBlockRecord(block));
  }

  // ── Flush open entities ──────────────────────────────────────────────────
  PKAPentahoParser.flush(openJobs, openTrfs, jobs, trfs);
  PKAExecutionBuilder.finalizeExecutions();

  const execArray  = PKAExecutionBuilder.getExecutions();
  const execStats  = PKAExecutionBuilder.getStats();
  const dedupStats = PKADeduplicator.getStats();

  postPhase('saving', 76);

  // ── Persist to IndexedDB ─────────────────────────────────────────────────
  // `blocks` is by far the largest store on a big log, so its own write
  // progress drives most of the "saving" range — otherwise the bar would
  // sit still for the longest, most database-heavy part of the whole job.
  await Promise.all([
    PKAStorage.bulkPut('executions',      execArray),
    PKAStorage.bulkPut('blocks',          blockRecords, (written, total) => {
      postPhase('saving', 76 + Math.round((written / total) * 22));
    }),
    PKAStorage.bulkPut('jobs',            jobs),
    PKAStorage.bulkPut('transformations', trfs),
    PKAStorage.bulkPut('variables',       variables),
    PKAStorage.bulkPut('errors',          errors),
    PKAStorage.bulkPut('metrics',         metrics),
    PKAStorage.bulkPut('dependencies',    dependencies),
  ]);

  postPhase('saving', 99);

  // ── Control contrasts (spec §10 step 8 / §Criterios de aceptación) ───────
  const stats = {
    linesTotal:        totalLines,
    linesHeader:       headerLines,
    linesContinuation: continuationLines,
    linesEmpty:        emptyLines,
    executionsOpened:    execStats.opens,
    executionsClosed:    execStats.closes,
    executionsIncomplete: execStats.incomplete,
    executionsWithError: execStats.withError,
    rootJobs:          new Set(execArray.map(e => e.rootJob)).size,
    blocksUnmatched:   dedupStats.unmatchedEmitted,
    blocksUnattributed: blockRecords.filter(b => b.anomaly === 'unattributed').length,
    executions:      execArray.length,
    jobs:            jobs.length,
    transformations: trfs.length,
    variables:       variables.length,
    errors:          errors.length,
    metrics:         metrics.length,
    dependencies:    dependencies.length,
  };

  // Save meta
  await PKAStorage.setMeta('lastFile', file.name);
  await PKAStorage.setMeta('lastIngest', Date.now());
  await PKAStorage.setMeta('linesProcessed', totalLines);
  await PKAStorage.setMeta('lastIngestStats', stats);

  _post({ type: 'DONE', stats });
}
