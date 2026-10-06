/**
 * parser.js — Streaming log line reader for PKA
 *
 * Reads the File via the Streams API in chunks, splits on newlines,
 * and emits parsed line objects without loading the entire file into memory.
 *
 * Usage (inside a Web Worker):
 *   const gen = PKAParser.stream(file, onProgress);
 *   for await (const line of gen) { ... }
 */

'use strict';

const PKAParser = (() => {

  const R = PKA_CONFIG.REGEX;

  /**
   * Async generator — yields normalized line objects one at a time.
   * @param {File} file
   * @param {function} onProgress — called with (bytesRead, totalBytes)
   */
  async function* stream(file, onProgress) {
    const totalBytes = file.size;
    let   bytesRead  = 0;
    let   lineBuffer = '';
    let   lineNo     = 0;

    const reader = file.stream().getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        bytesRead += value.byteLength;
        lineBuffer += decoder.decode(value, { stream: true });

        // Split on any newline convention
        const lines = lineBuffer.split(/\r?\n/);

        // Keep the last (potentially incomplete) fragment
        lineBuffer = lines.pop();

        for (const raw of lines) {
          lineNo++;
          const parsed = _parseLine(raw, lineNo);
          if (parsed) yield parsed;
        }

        if (onProgress) onProgress(bytesRead, totalBytes);
      }

      // Flush remaining buffer
      if (lineBuffer.length > 0) {
        lineNo++;
        const parsed = _parseLine(lineBuffer, lineNo);
        if (parsed) yield parsed;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse a single raw line string into a structured object. Empty lines
   * are returned as continuation content, never discarded (§2.5).
   */
  function _parseLine(raw, lineNo) {
    // Empty lines are continuation content (part of Write to Log multi-line
    // payloads), never discarded — see PDI_LOG_ANALYSIS_SPECIFICATION.md §2.5.
    if (!raw || raw.trim().length === 0) {
      return {
        lineNo,
        raw: raw || '',
        timestamp:  null,
        level:      null,
        thread:     null,
        component:  null,
        message:    '',
        isContinuation: true,
        isEmpty: true,
      };
    }

    const trimmed = raw.trim();

    // Try primary format: timestamp level <thread> [component] message
    let m = trimmed.match(R.LOG_LINE);
    if (m) {
      return {
        lineNo,
        raw,
        timestamp:  m[1],
        level:      m[2],
        thread:     m[3],
        component:  m[4],
        message:    m[5].trim(),
        isContinuation: false,
      };
    }

    // Try alternate format without [component]
    m = trimmed.match(R.LOG_LINE_ALT);
    if (m) {
      return {
        lineNo,
        raw,
        timestamp:  m[1],
        level:      m[2],
        thread:     m[3],
        component:  '',
        message:    m[4].trim(),
        isContinuation: false,
      };
    }

    // Non-standard line (stack trace, continuation, etc.)
    return {
      lineNo,
      raw,
      timestamp:  null,
      level:      null,
      thread:     null,
      component:  null,
      message:    trimmed,
      isContinuation: true,
    };
  }

  return { stream, _parseLine };
})();

if (typeof window !== 'undefined') window.PKAParser = PKAParser;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAParser = PKAParser;
