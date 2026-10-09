/**
 * Prints an HTML document from a frame inside this page.
 *
 * Never from a separate window. A print dialog in a popup freezes the page that opened it (they share one
 * browser process), and once the popup slips behind the till window the till looks dead: taps do nothing and
 * nothing on screen says why. Inside the page the dialog sits on top of the till and cannot get lost.
 */
let frame: HTMLIFrameElement | undefined;

export function printHtml(html: string): Promise<void> {
  return new Promise((done) => {
    frame?.remove(); // the previous job is long finished; a fresh frame makes `load` fire reliably
    const f = document.createElement('iframe');
    frame = f;
    f.className = 'cactus-print-frame';
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    // The receipt is text typed in by people (business name, footer, item names). It never needs to run script.
    f.setAttribute('sandbox', 'allow-same-origin allow-modals');
    // Off screen rather than display:none, which some browsers print as a blank page.
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:80mm;height:100px;border:0;opacity:0;pointer-events:none';
    f.addEventListener('load', () => {
      // Let the till paint what it was about to show before the dialog takes over.
      window.setTimeout(() => {
        try { f.contentWindow?.print(); } catch { /* printing is not available in this browser */ }
        done();
      }, 100);
    }, { once: true });
    f.srcdoc = html;
    document.body.append(f);
  });
}
