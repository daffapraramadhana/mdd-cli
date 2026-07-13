// src/ui/think.ts
// Streaming filter that SEPARATES <think>…</think> reasoning from the visible response.
// Tags may be split across deltas, so partial tags at a chunk boundary are held back.
// Returns two channels per call: `visible` (answer text) and `thinking` (reasoning).

const OPEN = '<think>';
const CLOSE = '</think>';

export class ThinkSplitter {
  private buf = '';
  private inThink = false;

  /** Feed a streamed delta; returns the visible answer text and reasoning ready to show. */
  push(delta: string): { visible: string; thinking: string } {
    this.buf += delta;
    let out = '';
    let think = '';
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
        if (lt === -1) { think += this.buf; this.buf = ''; break; } // reasoning content
        think += this.buf.slice(0, lt); // reasoning before '<'
        this.buf = this.buf.slice(lt);
        if (this.buf.startsWith(CLOSE)) { this.inThink = false; this.buf = this.buf.slice(CLOSE.length); continue; }
        if (CLOSE.startsWith(this.buf)) break; // partial "</think>" — wait
        think += '<'; this.buf = this.buf.slice(1); continue; // '<' inside think
      }
    }
    return { visible: out, thinking: think };
  }

  /** Flush any trailing buffered text at the end of a turn. */
  flush(): { visible: string; thinking: string } {
    const visible = this.inThink ? '' : this.buf;
    const thinking = this.inThink ? this.buf : '';
    this.buf = '';
    this.inThink = false;
    return { visible, thinking };
  }
}
