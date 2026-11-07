/** Panel CSS, applied via a constructable stylesheet inside the shadow root (CSP-safe, never scanned). */
export const PANEL_CSS: string = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.badge {
  position: fixed; inset: auto; margin: 0; padding: 6px 12px; border: 0; border-radius: 8px;
  color: #fff; font-size: 12px; font-weight: 600; cursor: pointer;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.3); background: #16a34a;
}
.badge:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
.badge.warn { background: #b45309; }
.badge.bad { background: #b91c1c; }
.bottom-left { bottom: 16px; left: 16px; } .bottom-right { bottom: 16px; right: 16px; }
.top-left { top: 16px; left: 16px; } .top-right { top: 16px; right: 16px; }
dialog {
  width: min(960px, 94vw); max-height: 88vh; padding: 20px; border: 0; border-radius: 12px;
  background: #1e1e2e; color: #e6e9f5; font-size: 13px; line-height: 1.5;
}
dialog::backdrop { background: rgb(0 0 0 / 0.6); }
h2 { margin: 0 0 8px; font-size: 18px; color: #d8c4ff; }
p, ul { margin: 0 0 10px; }
.warn-list { color: #fcd34d; }
.toolbar, .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; align-items: center; }
input, select { padding: 6px 8px; border-radius: 6px; border: 1px solid #585b70; background: #11111b; color: #e6e9f5; }
button.action { padding: 7px 12px; border: 0; border-radius: 6px; background: #3b4261; color: #fff; cursor: pointer; font-weight: 600; }
button.action:disabled { opacity: 0.5; cursor: not-allowed; }
button.action:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #93c5fd; outline-offset: 1px; }
button.primary { background: #2563eb; }
.results { list-style: none; padding: 0; margin: 0; max-height: 50vh; overflow: auto; border-top: 1px solid #45475a; }
.results li { padding: 4px 0; border-bottom: 1px solid #313244; display: grid; grid-template-columns: 1fr auto auto; gap: 12px; }
.mono { overflow-wrap: anywhere; }
.status-unused { color: #fca5a5; } .status-used { color: #86efac; } .status-state-dependent { color: #fde68a; }
.muted { color: #b4b9d0; }
`
