/**
 * block-builder.js — Groups normalized lines into blocks.
 *
 * A block is a header line plus every line without a timestamp that follows
 * it, up to the next header or end of file. Empty lines count as
 * continuation and never close a block. See
 * PDI_LOG_ANALYSIS_SPECIFICATION.md §7.
 */

'use strict';

const PKABlockBuilder = (() => {

  let _current   = null;
  let _blockSeq  = 0;

  function _newBlock(headerLine) {
    _blockSeq++;
    return {
      blockId:         `B${_blockSeq}`,
      headerLine,
      continuationRaw: [],
      startLineNo:     headerLine.lineNo,
      endLineNo:       headerLine.lineNo,
      pathChain:       headerLine.pathChain,
      identifierType:  headerLine.identifierType,
      thread:          headerLine.identifierType === 'thread' ? headerLine.thread : null,
      uuid:            headerLine.identifierType === 'uuid'   ? headerLine.uuid   : null,
      stepInfo:        headerLine.identifierType === 'step'   ? headerLine.stepInfo : null,
      ts:              headerLine.ts,
    };
  }

  /**
   * Feed one normalized line. Returns a closed block if this line closes
   * the previous one (i.e. this line is itself a header), otherwise null.
   */
  function pushLine(line) {
    if (!line) return null;

    if (!line.isContinuation) {
      // This line is a header: close whatever was open, start a new block.
      const closed = _current;
      _current = _newBlock(line);
      return closed;
    }

    // Continuation (including empty lines) — attach to the open block.
    // Per spec §5, no continuation ever appears before the first header.
    if (_current) {
      _current.continuationRaw.push(line.raw);
      _current.endLineNo = line.lineNo;
    }
    return null;
  }

  /** Call at end of stream to flush the last open block. */
  function flush() {
    const closed = _current;
    _current = null;
    return closed;
  }

  function reset() {
    _current  = null;
    _blockSeq = 0;
  }

  return { pushLine, flush, reset };
})();

if (typeof window !== 'undefined') window.PKABlockBuilder = PKABlockBuilder;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKABlockBuilder = PKABlockBuilder;
