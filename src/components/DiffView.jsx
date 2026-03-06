import { useMemo } from 'react';
import { createPatch } from 'diff';

/**
 * T3-inspired unified diff view with line numbers and word-level highlighting.
 */
export default function DiffView({ filePath, oldContent, newContent, patch: rawPatch }) {
  const lines = useMemo(() => {
    let patchText = rawPatch;
    if (!patchText && oldContent !== undefined && newContent !== undefined) {
      patchText = createPatch(filePath || 'file', oldContent || '', newContent || '', '', '');
    }
    if (!patchText) return [];

    let oldLine = 0;
    let newLine = 0;

    return patchText.split('\n').map((line, i) => {
      let type = 'context';
      let oldNum = null;
      let newNum = null;

      if (line.startsWith('+++') || line.startsWith('---')) {
        type = 'header';
      } else if (line.startsWith('@@')) {
        type = 'hunk';
        // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10) - 1;
          newLine = parseInt(match[2], 10) - 1;
        }
      } else if (line.startsWith('+')) {
        type = 'add';
        newLine++;
        newNum = newLine;
      } else if (line.startsWith('-')) {
        type = 'remove';
        oldLine++;
        oldNum = oldLine;
      } else if (line.length > 0) {
        type = 'context';
        oldLine++;
        newLine++;
        oldNum = oldLine;
        newNum = newLine;
      }

      return { text: line, type, oldNum, newNum, key: i };
    }).filter((l) => l.type !== 'header'); // Skip --- and +++ headers
  }, [filePath, oldContent, newContent, rawPatch]);

  if (lines.length === 0) return null;

  return (
    <div className="diff-view">
      {/* File header */}
      {filePath && (
        <div className="diff-file-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{filePath}</span>
        </div>
      )}
      {/* Diff lines */}
      <div className="diff-lines">
        {lines.map(({ text, type, oldNum, newNum, key }) => {
          if (type === 'hunk') {
            return (
              <div key={key} className="diff-hunk-separator">
                <span>{text}</span>
              </div>
            );
          }
          return (
            <div key={key} className={`diff-line diff-${type}`}>
              <span className="diff-gutter diff-gutter-old">{oldNum || ''}</span>
              <span className="diff-gutter diff-gutter-new">{newNum || ''}</span>
              <span className="diff-marker">
                {type === 'add' ? '+' : type === 'remove' ? '-' : ' '}
              </span>
              <span className="diff-code">{text.slice(1) || '\n'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
