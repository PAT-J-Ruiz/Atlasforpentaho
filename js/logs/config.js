/**
 * config.js — Global configuration for Pentaho Knowledge Analyzer
 * All regex patterns, thresholds, and constants live here.
 */

'use strict';

const PKA_CONFIG = {

  // ─── Streaming ─────────────────────────────────────────────────
  CHUNK_SIZE: 4 * 1024 * 1024,        // 4 MB per read chunk
  PROGRESS_INTERVAL: 250,             // ms between progress events

  // ─── IndexedDB ─────────────────────────────────────────────────
  DB_NAME: 'PKADatabase',
  DB_VERSION: 2,
  STORES: {
    EXECUTIONS:      'executions',
    BLOCKS:          'blocks',
    JOBS:            'jobs',
    TRANSFORMATIONS: 'transformations',
    VARIABLES:       'variables',
    ERRORS:          'errors',
    METRICS:         'metrics',
    DEPENDENCIES:    'dependencies',
    META:            'meta',
  },

  // ─── Log line patterns ─────────────────────────────────────────
  REGEX: {
    // Standard Pentaho log line:
    // 2026-09-14 12:01:27.557 INFO  <Thread-415638> [COMPONENT] message
    // The identifier can itself contain '>' (e.g. a step literally named
    // ">1900-01-01"), so it must be delimited by the LAST '>' that precedes
    // the path-chain bracket, not the first. `[^\[]*` cannot contain '[', so
    // it only spans the identifier region (before any bracket) and greedily
    // backtracks to the last '>' in that region — never into the message.
    LOG_LINE: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(INFO|WARN|ERROR|DEBUG|FATAL)\s+<([^[]*)>\s*\[([^\]]*)\]\s*(.*)/,

    // Alternate format without component bracket
    LOG_LINE_ALT: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(INFO|WARN|ERROR|DEBUG|FATAL)\s+<([^[]*)>\s*(.*)/,

    // Identifier classification (see PDI_LOG_ANALYSIS_SPECIFICATION.md §2.1-2.3)
    THREAD_ID:       /^Thread-\d+$/,
    UUID_IDENTIFIER: /^.+\s+UUID:\s*([0-9a-fA-F-]{36})$/,

    // Path-chain elements inside [ ... ] are separated by TWO OR MORE spaces —
    // a single path can legitimately contain one space.
    PATH_SEPARATOR:  /\s{2,}/,

    // Job events
    JOB_START:     /Start of job execution/i,
    JOB_FINISH:    /Finished job entry \[([^\]]+)\]\s*\(result=\[(true|false)\]\)/i,
    JOB_DISPATCH:  /Dispatching started for transformation \[([^\]]+)\]/i,
    JOB_NAME:      /^\[([^\]]+\.kjb)\]|Job\s+\[([^\]]+)\]/i,

    // Transformation events
    TRF_START:     /Dispatching started for transformation \[([^\]]+)\]/i,
    TRF_FINISH:    /Finished processing in transformation \[([^\]]+)\]/i,
    TRF_PREPARE:   /Preparing transformation for execution/i,

    // Step events
    STEP_FINISH:   /Finished processing \(I=(\d+),O=(\d+),R=(\d+),W=(\d+),U=(\d+),E=(\d+)\)/i,

    // Variables
    VAR_SET:       /Set variable\s+(\S+)\s+to value\s+\[([^\]]*)\]/i,
    VAR_GET:       /Get variable\s+(\S+)\s*=?\s*\[?([^\]]*)\]?/i,
    VAR_ENV:       /(?:environment variable|ENV VAR)\s+(\S+)\s*=\s*(.+)/i,

    // Execution/Process IDs
    ID_PROCESO:    /ID_PROCESO_CARGA[=:\s]+(\d+)/i,
    UUID:          /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,

    // Metrics
    METRICS:       /\(I=(\d+),O=(\d+),R=(\d+),W=(\d+),U=(\d+),E=(\d+)\)/i,
    DURATION:      /(\d+(?:\.\d+)?)\s*(?:ms|milliseconds?|seconds?|s\b)/i,

    // Errors & Exceptions
    EXCEPTION:     /(?:Exception|Error|FATAL)[:]\s*(.*)/i,
    CAUSED_BY:     /Caused by:\s*(.*)/i,
    STACK_FRAME:   /^\s+at\s+[\w.$<>]+/,

    // ─── Real execution-failure signals (message content ONLY — never
    // tested against identifiers, step/job names or path-chain elements,
    // so a step or transformation literally named e.g. "...SIN_ERROR..."
    // can never trigger a false positive). See PROMPT error-detection work.
    ERROR_PROCESSING_STOPPED: /An error occurred, processing will be stopped/i,
    ERROR_STEP_INIT_FAILED:   /Error initializing step/i,
    ERROR_INIT_FAILED:        /failed to initialize/i,
    ERROR_PREPARE_FAILED:     /Unable to prepare for execution/i,
    ERROR_STEPS_INIT_FAILED:  /We failed to initialize at least one step/i,
    ERROR_JAVA_EXCEPTION:     /\b[\w.]+\.exception\.\w*Exception\b/i,
    ERROR_STACK_FRAME_INLINE: /^at\s+[\w.$]+\(.*\)\s*$/,

    // DB errors
    ORA_ERROR:     /ORA-\d+/,
    SQL_EXCEPTION: /SQLServerException|SQLException/i,
    DEADLOCK:      /deadlock/i,
    TIMEOUT:       /(?:connection timed out|query timeout|lock timeout|read timed out)/i,

    // Infrastructure
    PERM_DENIED:   /permission denied/i,
    CONN_REFUSED:  /connection refused/i,
    HOST_UNREACH:  /host unreachable|no route to host/i,

    // File errors
    FILE_NOT_FOUND:/(?:file not found|no such file|cannot find file)/i,

    // HTTP errors
    HTTP_ERROR:    /\b(4\d{2}|5\d{2})\b(?:\s*[-–]\s*|\s+)(?:Unauthorized|Forbidden|Not Found|Internal Server Error|Bad Gateway|Service Unavailable)?/i,

    // Dependencies — infrastructure
    SMB_SHARE:     /\\\\([\w\-.]+)\\([\w\-.$]+(?:\\[^\s,]*)?)/g,
    LOCAL_PATH_WIN:/([A-Za-z]:\\(?:[^\s,;'"<>|]+))/g,
    LOCAL_PATH_UNIX:/(\/(?:mnt|data|opt|home|var|tmp|srv)\/[^\s,;'"<>|]+)/g,
    API_URL:       /https?:\/\/[\w\-.]+(:\d+)?(?:\/[^\s,;'"<>|]*)?/gi,
    SERVER_NAME:   /\b([A-Z]{2,}(?:WS|SQL|APP|DB|SRV|PRD|DEV|QA)\w*)\b/g,
    STORED_PROC:   /(?:exec(?:ute)?|call)\s+((?:\w+\.){0,2}(?:PRC|SP|USP|PROC)_\w+)/gi,
    DB_CONN:       /(?:jdbc:(?:sqlserver|oracle|postgresql|mysql):\/\/)([\w.\-:;=]+)/gi,
  },

  // ─── Known warnings: messages logged at ERROR level that are NOT failures.
  // A block whose message matches one of these is not counted as an error.
  // Add or remove patterns here as the team confirms them.
  KNOWN_WARNINGS: [
    // AWS CLI prints certificate warnings to stderr; Kettle logs stderr as ERROR.
    /InsecureRequestWarning/i,
    /Unverified HTTPS request is being made/i,
    /urllib3\.readthedocs\.io\/en\/latest\/advanced-usage\.html#ssl-warnings/i,
    /warnings\.warn\(/i,
    // Intentional abort when there is nothing to process.
    /^\s*No hay archivos\s*$/i,
  ],

  // ─── Entity status values ───────────────────────────────────────
  STATUS: {
    SUCCESS: 'success',
    FAILED:  'failed',
    RUNNING: 'running',
    UNKNOWN: 'unknown',
  },

  // ─── Error severity ─────────────────────────────────────────────
  SEVERITY: {
    FATAL:   { label: 'FATAL',   weight: 4 },
    ERROR:   { label: 'ERROR',   weight: 3 },
    WARN:    { label: 'WARN',    weight: 2 },
    INFO:    { label: 'INFO',    weight: 1 },
    DEBUG:   { label: 'DEBUG',   weight: 0 },
  },

  // ─── Performance thresholds ─────────────────────────────────────
  THRESHOLDS: {
    SLOW_JOB_MS:              60_000,   // 1 min
    SLOW_TRANSFORMATION_MS:   30_000,   // 30 sec
    HIGH_TIME_PER_ROW_MS:     1.0,      // 1 ms/row
    TREND_DEGRADATION_PCT:    20,       // flag if duration grows > 20%
    MAX_TOP_ITEMS:            10,
  },

  // ─── Block-level deduplication window ───────────────────────────
  // Duplicates are perfect but not adjacent (up to 3.615ms apart measured).
  // Window is bounded by BOTH time and count — whichever exhausts first.
  DEDUP_WINDOW_MS:    5000,
  DEDUP_WINDOW_COUNT: 400,

  // NOTE: EXECUTION_GAP_MS is intentionally removed. Per the corrected
  // specification (D5), no execution may ever be split by inactivity —
  // only "Job execution finished" on the same Thread closes an execution.

  // ─── UI ────────────────────────────────────────────────────────
  DEFAULT_THEME: 'dark',
  DEFAULT_PAGE_SIZE: 50,
};

// Make available in Workers (importScripts context has no window)
if (typeof window !== 'undefined') {
  window.PKA_CONFIG = PKA_CONFIG;
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.PKA_CONFIG = PKA_CONFIG;
}
