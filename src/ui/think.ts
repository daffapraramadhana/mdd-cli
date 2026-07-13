// src/ui/think.ts
// Streaming filter that drops <think>…</think> reasoning from the visible response.
// Tags may be split across deltas, so partial tags at a chunk boundary are held back.

const OPEN = '<think>';
const CLOSE = '</think>';

export class ThinkSplitter {
  private buf = '';
  private inThink = false;

  /** Feed a streamed delta; returns the visible (non-think) text ready to show. */
  push(delta: string): string {
    this.buf += delta;
    let out = '';
    for (;;) {
      if (!this.inThink) {
        const lt = this.buf.indexOf('<');
        if (lt === -1) { out += this.buf; this.buf = ''; break; }
        out += this.buf.slice(0, lt);
        this.buf = this.buf.slice(lt);
        if (this.buf.startsWith(OPEN)) { this.inThink = true; this.buf = this.buf.slice(OPEN.length); continue; }
        if (OPEN.startsWith(this.buf)) break; // partial "<think>" — wait for more
        out += '<'; this.buf = this.buf.slice(1); continue; // literal '<'
      } else {
        const lt = this.buf.indexOf('<');
        if (lt === -1) { this.buf = ''; break; } // drop think content
        this.buf = this.buf.slice(lt); // drop think content before '<'
        if (this.buf.startsWith(CLOSE)) { this.inThink = false; this.buf = this.buf.slice(CLOSE.length); continue; }
        if (CLOSE.startsWith(this.buf)) break; // partial "</think>" — wait
        this.buf = this.buf.slice(1); continue; // '<' inside think — drop
      }
    }
    return out;
  }

  /** Flush any trailing buffered text at the end of a turn. */
  flush(): string {
    const out = this.inThink ? '' : this.buf;
    this.buf = '';
    this.inThink = false;
    return out;
  }
}
