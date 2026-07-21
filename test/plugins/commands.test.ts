import { describe, it, expect } from 'vitest';
import { parseCommandFile, renderCommand } from '../../src/plugins/commands.js';

describe('parseCommandFile', () => {
  it('reads description and argument-hint from frontmatter', () => {
    const raw = `---\ndescription: Review the diff\nargument-hint: "[base]"\n---\nBody $ARGUMENTS`;
    const r = parseCommandFile(raw, 'review');
    expect(r.description).toBe('Review the diff');
    expect(r.argumentHint).toBe('[base]');
    expect(r.body).toBe('Body $ARGUMENTS');
  });

  it('defaults description to empty and body to whole file when no frontmatter', () => {
    const r = parseCommandFile('just a body', 'x');
    expect(r.description).toBe('');
    expect(r.argumentHint).toBeUndefined();
    expect(r.body).toBe('just a body');
  });
});

describe('renderCommand', () => {
  it('substitutes $ARGUMENTS and positional $1/$2', () => {
    const r = renderCommand('all=$ARGUMENTS first=$1 second=$2', 'a b');
    expect(r.text).toBe('all=a b first=a second=b');
    expect(r.prefill).toEqual([]);
  });

  it('missing positionals become empty string', () => {
    const r = renderCommand('x=$1 y=$2', 'only');
    expect(r.text).toBe('x=only y=');
  });

  it('extracts prefill spans in order, after arg substitution', () => {
    const r = renderCommand('diff:\n!`git diff $ARGUMENTS`\nlog:\n!`git log -1`', 'main');
    expect(r.prefill).toEqual(['git diff main', 'git log -1']);
    expect(r.text).toContain('!`git diff main`');
  });

  it('preserves literal $ sequences in arguments', () => {
    const r = renderCommand('cost=$ARGUMENTS', 'a $$ b');
    expect(r.text).toBe('cost=a $$ b');
  });

  it('does not re-interpret $N that appears inside substituted arguments', () => {
    const r = renderCommand('note: $ARGUMENTS', 'a $2 b');
    expect(r.text).toBe('note: a $2 b');
  });
});
